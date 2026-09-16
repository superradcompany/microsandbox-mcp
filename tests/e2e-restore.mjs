import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Sandbox, Snapshot } from "microsandbox";

// Opt-in live test: uses the selected local runtime, never installs or upgrades it.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-restore-live-")));
const prefix = `mcp-restore-${Date.now()}`;
const sourceName = `${prefix}-source`;
const children = [];
const snapshots = [];
const client = new Client({ name: "restore-test", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"],
  env: { ...process.env, MICROSANDBOX_MCP_HOST_PATHS: root, MICROSANDBOX_MCP_HOST_PATH_POLICY: "allowlist" }, stderr: "inherit" });
let source;
async function call(name, args, expectError = false) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(Boolean(result.isError), expectError, JSON.stringify(result));
  return result;
}
try {
  await client.connect(transport);
  source = await Sandbox.builder(sourceName).image("mirror.gcr.io/library/alpine").memory(512).detached(false).create();
  // diskOnly intentionally discards RAM, including dirty guest page-cache data.
  // Persist the disk marker before full capture; keep the RAM marker in tmpfs.
  const seeded = await source.shell("echo disk-ok > /root/marker; echo ram-ok > /dev/shm/marker; sync");
  assert.equal(seeded.code, 0);
  const full = await Snapshot.builder("full").fromSandbox(sourceName).full().create();
  snapshots.push(`${sourceName}:full`);
  const archive = path.join(root, "full.msnap");
  await Snapshot.save(full.path, archive);
  await source.stop();
  const disk = await Snapshot.builder("disk").fromSandbox(sourceName).create();
  snapshots.push(`${sourceName}:disk`);
  const diskArchive = path.join(root, "disk.msnap");
  await Snapshot.save(disk.path, diskArchive);
  for (const [label, args, memory] of [
    ["installed-full-eager", { snapshot: snapshots[0] }, true],
    ["installed-full-forked", { snapshot: snapshots[0], forked: true }, true],
    ["archive-full-eager", { snapshot: archive }, true],
    ["archive-full-forked", { snapshot: archive, forked: true }, true],
    ["archive-disk-only", { snapshot: archive, diskOnly: true }, false],
    ["disk-snapshot", { snapshot: snapshots[1] }, false],
    ["disk-archive", { snapshot: diskArchive }, false],
  ]) {
    const name = `${prefix}-${label}`;
    children.push(name);
    const start = performance.now();
    await call("sandbox_restore", { name, ...args });
    const elapsed = performance.now() - start;
    const output = await call("sandbox_shell", { name, command: `cat /root/marker && ${memory ? "cat /dev/shm/marker" : "test ! -e /dev/shm/marker"}`, treatNonZeroAsError: true });
    const check = JSON.parse(output.content[0].text).data;
    assert.equal(check.exitCode, 0);
    assert.match(check.stdout, /disk-ok/);
    if (memory) assert.match(check.stdout, /ram-ok/);
    await call("sandbox_stop", { name });
    await Sandbox.remove(name);
    console.log(`${label}: PASS ${elapsed.toFixed(2)} ms`);
  }
  const failedName = `${prefix}-invalid`;
  await call("sandbox_restore", { name: failedName, snapshot: "nonexistent-snapshot" }, true);
  await call("sandbox_restore", { name: failedName, snapshot: archive, memoryMib: 128 }, true);
  await call("sandbox_create", { name: failedName, rootfs: { kind: "snapshot", pathOrName: archive } }, true);
  await assert.rejects(() => Sandbox.get(failedName));
  console.log("invalid restore/create requests: PASS (no sandbox created)");
} finally {
  await client.close();
  for (const name of [...children, sourceName]) {
    try { const handle = await Sandbox.get(name); if (handle.status === "running") await handle.kill(); await Sandbox.remove(name); }
    catch (error) { if (!String(error).match(/not found|not exist/i)) console.error(`cleanup ${name}: ${error}`); }
  }
  // Remove ancestors before the current head; group heads are protected while
  // other members remain. Force is limited to this test's captured lineage.
  for (const snapshot of snapshots) {
    try { await Snapshot.remove(snapshot, { force: true }); }
    catch (error) { console.error(`cleanup snapshot ${snapshot}: ${error}`); }
  }
  fs.rmSync(root, { recursive: true, force: true });
}
