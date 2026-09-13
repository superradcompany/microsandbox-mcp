import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Sandbox, Snapshot } from "microsandbox";
import { resetServerConfigForTests } from "../dist/config.js";
import { registerSandboxTools, sandboxRestoreSchema } from "../dist/tools/sandbox.js";

function tools() {
  const registered = new Map();
  registerSandboxTools({ registerTool(name, config, handler) { registered.set(name, { config, handler }); } });
  return registered;
}

test("restore rejects creation settings and create/run reject snapshot rootfs", () => {
  for (const field of ["cpus", "memoryMib", "image", "env", "patches", "resources", "process", "lifecycle", "command", "dangerouslyInheritResources"]) {
    assert.equal(sandboxRestoreSchema.safeParse({ name: "child", snapshot: "app:ready", [field]: {} }).success, false, field);
  }
  for (const name of ["sandbox_create", "sandbox_run"]) {
    const schema = tools().get(name).config.inputSchema;
    assert.equal(schema.safeParse({ name: "child", command: "true", rootfs: { kind: "snapshot", pathOrName: "app:ready" } }).success, false);
    assert.equal(schema.safeParse({ name: "fresh", command: "true", image: "alpine" }).success, true);
  }
});

test("restore uses the dedicated terminal and forwards only explicit mappings", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-restore-")));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); resetServerConfigForTests(); });
  t.mock.method(process, "cwd", () => root);
  t.mock.method(Snapshot, "get", async (ref) => ({ path: `/indexed/${ref}` }));
  const calls = [];
  const mount = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return mount; } });
  const builder = new Proxy({}, { get: (_, name) => (...args) => {
    if (name === "volume") args[1](mount);
    calls.push([name, ...args.filter((arg) => typeof arg !== "function")]);
    if (name === "restore") return Promise.resolve({});
    return builder;
  } });
  t.mock.method(Sandbox, "restore", (snapshot) => { calls.push(["source", snapshot]); return builder; });
  t.mock.method(Sandbox, "builder", () => { throw new Error("restore must never create"); });
  resetServerConfigForTests();
  const handler = tools().get("sandbox_restore").handler;
  const response = await handler({ name: "child", snapshot: "app:ready", snapshotBase: "app:base", forked: true,
    externalMountPolicy: "strict", user: "1000", logLevel: "warn",
    volumes: [{ kind: "bind", guestPath: "/data", hostPath: root, readonly: true }],
    ports: [{ hostPort: 8080, guestPort: 80 }, { hostPort: 5353, guestPort: 53, protocol: "udp", bindAddress: "127.0.0.1" }],
    vsock: [{ path: path.join(root, "agent.sock"), port: 9000 }],
  });
  assert.equal(JSON.parse(response.content[0].text).ok, true);
  for (const call of [["source", "/indexed/app:ready"], ["snapshotBase", "/indexed/app:base"], ["name", "child"], ["forked"],
    ["externalMountPolicy", "strict"], ["bind", root], ["readonly"], ["port", 8080, 80], ["portUdpBind", "127.0.0.1", 5353, 53], ["restore"]]) {
    assert.ok(calls.some((actual) => JSON.stringify(actual) === JSON.stringify(call)), JSON.stringify(call));
  }
  calls.length = 0;
  await handler({ name: "plain", snapshot: "app:ready", diskOnly: true, externalMountPolicy: "relaxed" });
  assert.deepEqual(calls, [["source", "/indexed/app:ready"], ["name", "plain"], ["diskOnly"], ["externalMountPolicy", "relaxed"], ["restore"]]);
  t.mock.method(Sandbox, "restore", () => ({ name: () => ({ restore: async () => { throw new Error("restore failed"); } }) }));
  const failed = await handler({ name: "failed", snapshot: "app:ready" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /restore failed/);
});

test("restore enforces host policy for archives, bases, mounts and sockets", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-restore-policy-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-restore-outside-")));
  const oldPaths = process.env.MICROSANDBOX_MCP_HOST_PATHS;
  const oldPolicy = process.env.MICROSANDBOX_MCP_HOST_PATH_POLICY;
  process.env.MICROSANDBOX_MCP_HOST_PATHS = root;
  process.env.MICROSANDBOX_MCP_HOST_PATH_POLICY = "allowlist";
  resetServerConfigForTests();
  t.after(() => {
    for (const [key, value] of [["MICROSANDBOX_MCP_HOST_PATHS", oldPaths], ["MICROSANDBOX_MCP_HOST_PATH_POLICY", oldPolicy]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    resetServerConfigForTests();
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
  });
  t.mock.method(Snapshot, "get", async () => ({ path: "/indexed/ready" }));
  let restores = 0;
  const mount = new Proxy({}, { get: () => () => mount });
  const builder = new Proxy({}, { get: (_, name) => (...args) => {
    if (name === "volume") args[1](mount);
    if (name === "restore") { restores++; return Promise.resolve({}); }
    return builder;
  } });
  t.mock.method(Sandbox, "restore", () => builder);
  const handler = tools().get("sandbox_restore").handler;
  const denied = path.join(outside, "state.msnap");
  fs.writeFileSync(denied, "fixture");
  for (const extra of [{ snapshot: denied }, { snapshotBase: denied },
    { volumes: [{ kind: "disk", guestPath: "/disk", hostPath: denied }] },
    { vsock: [{ path: denied, port: 9000 }] }]) {
    const result = await handler({ name: "child", snapshot: "app:ready", ...extra });
    assert.equal(JSON.parse(result.content[0].text).error.code, "host_path_denied");
  }
  // A bare filename, including a symlink to a denied file, is still a host path.
  const link = path.join(root, "state.msnap");
  fs.symlinkSync(denied, link);
  const previousCwd = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previousCwd));
  assert.equal((await handler({ name: "child", snapshot: "state.msnap" })).isError, true);
  assert.equal(restores, 0);
  const allowed = path.join(root, "allowed.msnap");
  fs.writeFileSync(allowed, "fixture");
  assert.equal((await handler({ name: "child", snapshot: allowed })).isError, undefined);
  assert.equal(restores, 1);
});
