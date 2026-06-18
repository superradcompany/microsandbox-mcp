import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = process.cwd();
const runId = `${Date.now()}-${process.pid}`;
const prefix = `mcp-e2e-${runId}`;
const image = process.env.MICROSANDBOX_MCP_E2E_IMAGE ?? "alpine:latest";
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "microsandbox-mcp-e2e-"));
const reportPath = path.join(tmpRoot, "report.json");
const hostIn = path.join(tmpRoot, "host-in.txt");
const hostOut = path.join(tmpRoot, "host-out.txt");
const snapshotArchive = path.join(tmpRoot, "snapshot.tar.zst");
const importedSnapshotsDir = path.join(tmpRoot, "imported-snapshots");
const destructiveCache = process.env.MICROSANDBOX_MCP_E2E_DESTRUCTIVE_CACHE === "1";

fs.writeFileSync(hostIn, "host-copy-ok\n");
fs.mkdirSync(importedSnapshotsDir);

const names = {
  sandbox: `${prefix}-sandbox`,
  peer: `${prefix}-peer`,
  volume: `${prefix}-volume`,
  diskVolume: `${prefix}-disk-volume`,
  snapshot: `${prefix}-snapshot`,
  run: `${prefix}-run`,
};

const expectedTools = [
  "runtime_check",
  "runtime_install",
  "sandbox_run",
  "sandbox_create",
  "sandbox_start",
  "sandbox_list",
  "sandbox_status",
  "sandbox_inspect",
  "sandbox_stop",
  "sandbox_drain",
  "sandbox_wait",
  "sandbox_remove",
  "sandbox_exec",
  "sandbox_shell",
  "sandbox_exec_start",
  "sandbox_exec_poll",
  "sandbox_exec_write_stdin",
  "sandbox_exec_signal",
  "sandbox_exec_close",
  "sandbox_logs_read",
  "sandbox_logs_stream",
  "sandbox_fs_read",
  "sandbox_fs_write",
  "sandbox_fs_list",
  "sandbox_fs_mkdir",
  "sandbox_fs_remove",
  "sandbox_fs_copy",
  "sandbox_fs_rename",
  "sandbox_fs_stat",
  "sandbox_fs_exists",
  "sandbox_fs_copy_from_host",
  "sandbox_fs_copy_to_host",
  "volume_create",
  "volume_list",
  "volume_inspect",
  "volume_remove",
  "volume_fs_read",
  "volume_fs_write",
  "volume_fs_list",
  "volume_fs_mkdir",
  "volume_fs_remove",
  "volume_fs_copy",
  "volume_fs_rename",
  "volume_fs_stat",
  "volume_fs_exists",
  "sandbox_metrics",
  "sandbox_metrics_all",
  "sandbox_metrics_stream",
  "image_list",
  "image_inspect",
  "image_remove",
  "image_prune",
  "snapshot_create",
  "snapshot_list",
  "snapshot_inspect",
  "snapshot_verify",
  "snapshot_remove",
  "snapshot_reindex",
  "snapshot_export",
  "snapshot_import",
  "sandbox_ssh_exec",
  "sandbox_sftp_read",
  "sandbox_sftp_write",
  "sandbox_sftp_mkdir",
  "sandbox_sftp_remove",
  "sandbox_sftp_rename",
  "sandbox_sftp_realpath",
  "sandbox_sftp_readlink",
  "sandbox_sftp_symlink",
];

const expectedResources = [
  "microsandbox://runtime",
  "microsandbox://sandboxes",
  "microsandbox://volumes",
  "microsandbox://images",
  "microsandbox://snapshots",
  "microsandbox://schemas/sandbox-create",
  "microsandbox://policy",
];

const results = [];
const calledTools = new Set();
let client;
let transport;
let runtimeInstalled = false;
let inspectedImageRef = image;
let snapshotPathOrName = names.snapshot;
let importedSnapshotPath = null;

try {
  ({ client, transport } = await connectClient());

  await step("protocol.ping", async () => {
    await client.ping(undefined, { timeout: 30_000 });
  });

  await step("protocol.listTools", async () => {
    const listed = await client.listTools(undefined, { timeout: 30_000 });
    assert.deepEqual(listed.tools.map((tool) => tool.name), expectedTools);
  });

  await step("protocol.listResources", async () => {
    const listed = await client.listResources(undefined, { timeout: 30_000 });
    assert.deepEqual(listed.resources.map((resource) => resource.uri), expectedResources);
  });

  for (const uri of expectedResources) {
    await step(`resource.${uri}`, async () => {
      const resource = await client.readResource({ uri }, { timeout: 30_000 });
      assert.equal(resource.contents.length, 1);
      const text = resource.contents[0].text;
      assert.equal(typeof text, "string");
      JSON.parse(text);
    });
  }

  const runtime = await callOk("runtime_check", {});
  runtimeInstalled = runtime.installed === true;
  await callOk("runtime_install", {});

  if (!runtimeInstalled) {
    skipLiveTools("runtime_check reported installed=false");
  } else {
    await cleanupKnownResources();

  await callOk("sandbox_run", {
    name: names.run,
    image,
    command: "printf run-ok",
    resources: { cpus: 1, memoryMib: 512 },
    lifecycle: { replace: true, detached: false, logLevel: "info" },
  }, (data) => {
    assert.equal(data.exitCode, 0);
    assert.equal(data.stdout, "run-ok");
  });

  await callOk("sandbox_create", sandboxCreateArgs(names.sandbox));
  await callOk("sandbox_create", sandboxCreateArgs(names.peer, { peer: true }));

  await callOk("sandbox_list", { labels: { "mcp-e2e": runId }, status: "all" }, (data) => {
    assert.ok(data.some((sandbox) => sandbox.name === names.sandbox));
  });
  await callOk("sandbox_status", { name: names.sandbox }, (data) => {
    assert.equal(data[0].name, names.sandbox);
  });
  await callOk("sandbox_inspect", { name: names.sandbox }, (data) => {
    assert.equal(data.name, names.sandbox);
    assert.equal(data.status, "running");
  });

  await callOk("sandbox_exec", {
    name: names.sandbox,
    command: "sh",
    args: ["-c", "printf exec-$E2E_VALUE"],
    cwd: "/tmp",
    env: { E2E_VALUE: "ok" },
    user: "root",
    tty: false,
    timeoutMs: 30_000,
    rlimits: [{ resource: "nofile", soft: 256, hard: 512 }],
    maxBytes: 1024,
    treatNonZeroAsError: true,
  }, (data) => {
    assert.equal(data.stdout, "exec-ok");
    assert.equal(data.success, true);
  });

  await callOk("sandbox_shell", {
    name: names.sandbox,
    command: "printf shell-$E2E_VALUE",
    env: { E2E_VALUE: "ok" },
    cwd: "/tmp",
    timeoutMs: 30_000,
    maxBytes: 1024,
  }, (data) => {
    assert.equal(data.stdout, "shell-ok");
  });

  const catSession = await callOk("sandbox_exec_start", {
    name: names.sandbox,
    command: "cat",
    timeoutMs: 30_000,
    tty: false,
  });
  await callOk("sandbox_exec_write_stdin", {
    execSessionId: catSession.execSessionId,
    data: "stdin-ok\n",
    close: true,
  });
  await waitForExecOutput(catSession.execSessionId, "stdin-ok");
  await callOk("sandbox_exec_close", { execSessionId: catSession.execSessionId });

  const shellSession = await callOk("sandbox_exec_start", {
    name: names.sandbox,
    command: "printf session-ok",
    shell: true,
    timeoutMs: 30_000,
    closeStdin: true,
  });
  await waitForExecDone(shellSession.execSessionId);
  await callOk("sandbox_exec_close", { execSessionId: shellSession.execSessionId });

  const sleepSession = await callOk("sandbox_exec_start", {
    name: names.sandbox,
    command: "sleep",
    args: ["30"],
    timeoutMs: 60_000,
  });
  await callOk("sandbox_exec_signal", {
    execSessionId: sleepSession.execSessionId,
    signal: "term",
  });
  await waitForExecDone(sleepSession.execSessionId);
  await callOk("sandbox_exec_close", { execSessionId: sleepSession.execSessionId });

  await callOk("sandbox_fs_write", {
    name: names.sandbox,
    path: "/tmp/e2e.txt",
    content: "fs-ok",
    encoding: "utf8",
  });
  await callOk("sandbox_fs_read", {
    name: names.sandbox,
    path: "/tmp/e2e.txt",
    encoding: "utf8",
    maxBytes: 1024,
  }, (data) => assert.equal(data.content, "fs-ok"));
  await callOk("sandbox_fs_read", {
    name: names.sandbox,
    path: "/tmp/e2e.txt",
    encoding: "base64",
    maxBytes: 1024,
  }, (data) => assert.equal(Buffer.from(data.content, "base64").toString("utf8"), "fs-ok"));
  await callOk("sandbox_fs_mkdir", { name: names.sandbox, path: "/tmp/e2e-dir" });
  await callOk("sandbox_fs_list", { name: names.sandbox, path: "/tmp" });
  await callOk("sandbox_fs_stat", { name: names.sandbox, path: "/tmp/e2e.txt" });
  await callOk("sandbox_fs_exists", { name: names.sandbox, path: "/tmp/e2e.txt" }, (data) => assert.equal(data.exists, true));
  await callOk("sandbox_fs_copy", {
    name: names.sandbox,
    from: "/tmp/e2e.txt",
    to: "/tmp/e2e-copy.txt",
  });
  await callOk("sandbox_fs_copy", {
    name: names.sandbox,
    from: "/tmp/e2e.txt",
    toSandbox: names.peer,
    to: "/tmp/e2e-from-peer-copy.txt",
  });
  await callOk("sandbox_fs_rename", {
    name: names.sandbox,
    from: "/tmp/e2e-copy.txt",
    to: "/tmp/e2e-renamed.txt",
  });
  await callOk("sandbox_fs_copy_from_host", {
    name: names.sandbox,
    hostPath: hostIn,
    guestPath: "/tmp/host-in.txt",
  });
  await callOk("sandbox_fs_copy_to_host", {
    name: names.sandbox,
    guestPath: "/tmp/host-in.txt",
    hostPath: hostOut,
  });
  assert.equal(fs.readFileSync(hostOut, "utf8"), "host-copy-ok\n");
  await callOk("sandbox_fs_remove", { name: names.sandbox, path: "/tmp/e2e-renamed.txt", kind: "file" });
  await callOk("sandbox_fs_remove", { name: names.sandbox, path: "/tmp/e2e-dir", kind: "dir" });

  await callOk("sandbox_logs_read", {
    name: names.sandbox,
    tail: 50,
    sources: ["stdout", "stderr", "output"],
    grep: "ok",
    maxBytes: 1024,
  });
  await callOk("sandbox_logs_stream", {
    name: names.sandbox,
    sources: ["stdout", "stderr", "output"],
    follow: false,
    limit: 10,
    maxBytes: 1024,
  });

  await callOk("sandbox_metrics", { name: names.sandbox }, (data) => {
    assert.equal(typeof data.cpuPercent, "number");
  });
  await callOk("sandbox_metrics_all", {});
  await callOk("sandbox_metrics_stream", {
    name: names.sandbox,
    intervalMs: 100,
    samples: 1,
  }, (data) => {
    assert.equal(data.samples.length, 1);
  });

  await callOk("sandbox_ssh_exec", {
    name: names.sandbox,
    command: "printf ssh-ok",
    user: "root",
    tty: false,
    maxBytes: 1024,
  }, (data) => assert.equal(data.stdout, "ssh-ok"));
  await callOk("sandbox_sftp_write", {
    name: names.sandbox,
    path: "/tmp/sftp.txt",
    content: "sftp-ok",
    encoding: "utf8",
  });
  await callOk("sandbox_sftp_read", {
    name: names.sandbox,
    path: "/tmp/sftp.txt",
    encoding: "utf8",
    maxBytes: 1024,
  }, (data) => assert.equal(data.content, "sftp-ok"));
  await callOk("sandbox_sftp_read", {
    name: names.sandbox,
    path: "/tmp/sftp.txt",
    encoding: "base64",
    maxBytes: 1024,
  }, (data) => assert.equal(Buffer.from(data.content, "base64").toString("utf8"), "sftp-ok"));
  await callOk("sandbox_sftp_mkdir", { name: names.sandbox, path: "/tmp/sftp-dir" });
  await callOk("sandbox_sftp_rename", {
    name: names.sandbox,
    from: "/tmp/sftp.txt",
    to: "/tmp/sftp-renamed.txt",
  });
  await callOk("sandbox_sftp_realpath", { name: names.sandbox, path: "/tmp/sftp-renamed.txt" });
  await callOk("sandbox_sftp_symlink", {
    name: names.sandbox,
    target: "/tmp/sftp-renamed.txt",
    linkPath: "/tmp/sftp-link",
  });
  await callOk("sandbox_sftp_readlink", { name: names.sandbox, path: "/tmp/sftp-link" });
  await callOk("sandbox_sftp_remove", { name: names.sandbox, path: "/tmp/sftp-link", kind: "file" });
  await callOk("sandbox_sftp_remove", { name: names.sandbox, path: "/tmp/sftp-renamed.txt", kind: "file" });
  await callOk("sandbox_sftp_remove", { name: names.sandbox, path: "/tmp/sftp-dir", kind: "dir" });

  await callOk("volume_create", {
    name: names.volume,
    kind: "directory",
    quotaMib: 64,
    labels: { "mcp-e2e": runId },
  });
  await callOk("volume_create", {
    name: names.diskVolume,
    kind: "disk",
    sizeMib: 256,
    labels: { "mcp-e2e": runId },
  });
  await callOk("volume_list", {}, (data) => assert.ok(data.some((volume) => volume.name === names.volume)));
  await callOk("volume_inspect", { name: names.volume }, (data) => assert.equal(data.name, names.volume));
  await callOk("volume_fs_write", {
    name: names.volume,
    path: "vol.txt",
    content: "volume-ok",
    encoding: "utf8",
  });
  await callOk("volume_fs_read", {
    name: names.volume,
    path: "vol.txt",
    encoding: "utf8",
    maxBytes: 1024,
  }, (data) => assert.equal(data.content, "volume-ok"));
  await callOk("volume_fs_read", {
    name: names.volume,
    path: "vol.txt",
    encoding: "base64",
    maxBytes: 1024,
  }, (data) => assert.equal(Buffer.from(data.content, "base64").toString("utf8"), "volume-ok"));
  await callOk("volume_fs_mkdir", { name: names.volume, path: "dir" });
  await callOk("volume_fs_list", { name: names.volume, path: "." });
  await callOk("volume_fs_stat", { name: names.volume, path: "vol.txt" });
  await callOk("volume_fs_exists", { name: names.volume, path: "vol.txt" }, (data) => assert.equal(data.exists, true));
  await callOk("volume_fs_copy", { name: names.volume, from: "vol.txt", to: "vol-copy.txt" });
  await callOk("volume_fs_rename", { name: names.volume, from: "vol-copy.txt", to: "vol-renamed.txt" });
  await callOk("volume_fs_remove", { name: names.volume, path: "vol-renamed.txt", kind: "file" });
  await callOk("volume_fs_remove", { name: names.volume, path: "dir", kind: "dir" });

  await callOk("image_list", {}, (data) => {
    if (data.length > 0) inspectedImageRef = data[0].reference;
  });
  await callOk("image_inspect", { reference: inspectedImageRef });
  await callError("image_remove", {
    reference: `${prefix}-missing-image:latest`,
    force: false,
  });
  if (destructiveCache) {
    await callOk("image_prune", { confirm: true });
  } else {
    await callError("image_prune", { confirm: false });
  }

  await callOk("sandbox_stop", { name: names.peer, timeoutMs: 30_000 });
  await callOk("sandbox_start", { name: names.peer });
  await callOk("sandbox_drain", { name: names.peer });
  await callOk("sandbox_stop", { name: names.peer, force: true, timeoutMs: 30_000 });
  await callOk("sandbox_wait", { name: names.peer });

  await callOk("sandbox_stop", { name: names.sandbox, timeoutMs: 30_000 });
  await callOk("sandbox_wait", { name: names.sandbox });

  const snapshot = await callOk("snapshot_create", {
    sourceSandbox: names.sandbox,
    name: names.snapshot,
    labels: { "mcp-e2e": runId },
    recordIntegrity: true,
  });
  snapshotPathOrName = snapshot.path ?? names.snapshot;
  await callOk("snapshot_list", {}, (data) => assert.ok(data.some((entry) => entry.name === names.snapshot || entry.path === snapshotPathOrName)));
  await callOk("snapshot_inspect", { pathOrName: names.snapshot, verify: true });
  await callOk("snapshot_verify", { pathOrName: names.snapshot });
  await callOk("snapshot_export", {
    pathOrName: names.snapshot,
    out: snapshotArchive,
    withParents: true,
    withImage: false,
  });
  await callError("snapshot_import", {
    archive: snapshotArchive,
    dest: importedSnapshotsDir,
  }, (error) => {
    assert.match(error.message, /SnapshotIntegrity|integrity/i);
  });
  await callOk("snapshot_reindex", { dir: importedSnapshotsDir });

  await callOk("sandbox_start", { name: names.sandbox });
  await callOk("sandbox_stop", { name: names.sandbox, force: true, timeoutMs: 30_000 });
  await callOk("sandbox_remove", { names: [names.sandbox, names.peer], force: true });

  await callOk("snapshot_remove", {
    pathOrNames: [names.snapshot, importedSnapshotPath].filter(Boolean),
    force: true,
    confirm: true,
  });
  importedSnapshotPath = null;

  await callOk("volume_remove", {
    names: [names.volume, names.diskVolume],
  });

    await assertEveryToolWasCalled();
  }
} finally {
  await bestEffortCleanup();
  if (client) await client.close();
  writeReport();
  printSummary();
}

async function connectClient() {
  const env = cleanEnv({
    ...process.env,
    MICROSANDBOX_MCP_HOST_PATHS: [
      fs.realpathSync.native(repoRoot),
      fs.realpathSync.native(tmpRoot),
    ].join(path.delimiter),
    MICROSANDBOX_MCP_HOST_PATH_POLICY: "allowlist",
    MICROSANDBOX_MCP_MAX_OUTPUT_BYTES: "4096",
    MICROSANDBOX_MCP_SESSION_TTL_MS: "60000",
  });
  const stdio = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: repoRoot,
    env,
    stderr: "pipe",
  });
  stdio.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  const mcpClient = new Client({ name: "microsandbox-mcp-e2e", version: "0.0.0" });
  await mcpClient.connect(stdio, { timeout: 30_000 });
  return { client: mcpClient, transport: stdio };
}

function sandboxCreateArgs(name, options = {}) {
  return {
    name,
    rootfs: {
      kind: "oci",
      reference: image,
      pullPolicy: "if-missing",
    },
    resources: { cpus: 1, memoryMib: 512 },
    process: {
      workdir: "/tmp",
      env: { E2E_SANDBOX: name },
      labels: { "mcp-e2e": runId, role: options.peer ? "peer" : "primary" },
      user: "root",
      scripts: { "e2e.sh": "echo script-ok" },
      rlimits: [{ resource: "nofile", soft: 256, hard: 512 }],
      init: undefined,
    },
    lifecycle: {
      detached: true,
      replace: true,
      logLevel: "info",
      metricsSampleIntervalMs: 1000,
    },
    mounts: [
      { kind: "tmpfs", guestPath: "/mnt/e2e-tmp", sizeMib: 8, noexec: true, nosuid: true },
      { kind: "bind", hostPath: tmpRoot, guestPath: "/mnt/e2e-host", readonly: true },
    ],
    patches: [
      { kind: "mkdir", path: "/tmp/e2e-patched", mode: 0o755 },
      { kind: "text", path: "/tmp/e2e-patched/hello.txt", content: "patched-ok", replace: true },
    ],
    network: {
      maxConnections: 64,
      dns: { allowRebind: true, queryTimeoutMs: 1000 },
      tls: { bypassDomains: ["example.com"], blockQuic: true, trustHostCas: true },
    },
    secrets: [{
      envVar: "E2E_SECRET",
      value: "not-for-logs",
      allowedHost: "example.com",
    }],
  };
}

async function callOk(name, args, validate) {
  calledTools.add(name);
  return await step(`tool.${name}`, async () => {
    const body = await callTool(name, args);
    assert.equal(body.ok, true, `${name} returned error: ${JSON.stringify(body.error)}`);
    if (validate) await validate(body.data, body);
    return body.data;
  });
}

async function callError(name, args, validate) {
  calledTools.add(name);
  return await step(`tool.${name}.error`, async () => {
    const body = await callTool(name, args);
    assert.equal(body.ok, false, `${name} was expected to fail`);
    if (validate) await validate(body.error, body);
    return body.error;
  });
}

async function callTool(name, args) {
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 600_000 },
  );
  const text = result.content?.[0]?.text;
  assert.equal(typeof text, "string", `${name} did not return text content`);
  return JSON.parse(text);
}

async function waitForExecOutput(execSessionId, needle) {
  for (let i = 0; i < 30; i += 1) {
    const data = await callOk("sandbox_exec_poll", { execSessionId, cursor: 0, limit: 100, maxBytes: 2048 });
    if (JSON.stringify(data.events).includes(needle)) return data;
    await sleep(250);
  }
  throw new Error(`exec session ${execSessionId} did not produce ${needle}`);
}

async function waitForExecDone(execSessionId) {
  for (let i = 0; i < 60; i += 1) {
    const data = await callOk("sandbox_exec_poll", { execSessionId, cursor: 0, limit: 100, maxBytes: 2048 });
    if (data.done) return data;
    await sleep(250);
  }
  throw new Error(`exec session ${execSessionId} did not finish`);
}

async function assertEveryToolWasCalled() {
  const missing = expectedTools.filter((tool) => !calledTools.has(tool));
  assert.deepEqual(missing, []);
}

async function cleanupKnownResources() {
  await ignoreTool("sandbox_remove", { names: [names.sandbox, names.peer, names.run], force: true });
  await ignoreTool("volume_remove", { names: [names.volume, names.diskVolume] });
  await ignoreTool("snapshot_remove", { pathOrNames: [names.snapshot, importedSnapshotPath].filter(Boolean), force: true, confirm: true });
}

async function bestEffortCleanup() {
  if (!client) return;
  await ignoreTool("sandbox_remove", { names: [names.sandbox, names.peer, names.run], force: true });
  await ignoreTool("volume_remove", { names: [names.volume, names.diskVolume] });
  await ignoreTool("snapshot_remove", { pathOrNames: [names.snapshot, importedSnapshotPath].filter(Boolean), force: true, confirm: true });
}

async function ignoreTool(name, args) {
  try {
    await callTool(name, args);
  } catch {
    // Cleanup is best-effort.
  }
}

function skipLiveTools(reason) {
  const liveTools = expectedTools.filter((tool) => !["runtime_check", "runtime_install"].includes(tool));
  for (const tool of liveTools) {
    results.push({ name: `tool.${tool}`, status: "skipped", reason });
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    results.push({ name, status: "passed", durationMs: Date.now() - started });
    return value;
  } catch (error) {
    results.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    throw error;
  }
}

function writeReport() {
  fs.writeFileSync(reportPath, JSON.stringify({
    runId,
    image,
    tmpRoot,
    destructiveCache,
    calledTools: [...calledTools].sort(),
    expectedTools,
    expectedResources,
    results,
  }, null, 2));
}

function printSummary() {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  console.log(JSON.stringify({ passed, failed, skipped, reportPath }, null, 2));
}

function cleanEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter((entry) => typeof entry[1] === "string"),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
