import assert from "node:assert/strict";
import test from "node:test";
import { Sandbox } from "microsandbox";
import { registerSandboxTools } from "../dist/tools/sandbox.js";

function tool(name) {
  const tools = new Map();
  registerSandboxTools({ registerTool: (name, config, handler) => tools.set(name, { config, handler }) });
  const { config, handler } = tools.get(name);
  return (args) => handler(config.inputSchema.parse(args));
}

test("snapshot input uses the restore API and preserves explicit destination settings", async (t) => {
  const calls = [];
  const sandbox = { detach: async () => calls.push(["detach"]) };
  const builder = {
    name(value) { calls.push(["name", value]); return this; },
    user(value) { calls.push(["user", value]); return this; },
    logLevel(value) { calls.push(["logLevel", value]); return this; },
    portUdpBind(...args) { calls.push(["portUdpBind", ...args]); return this; },
    restore: async () => { calls.push(["restore"]); return sandbox; },
  };
  t.mock.method(Sandbox, "restore", (source) => { calls.push(["source", source]); return builder; });
  t.mock.method(Sandbox, "builder", () => { throw new Error("restore must not cold-boot through create"); });
  const result = await tool("sandbox_create")({
    name: "child",
    rootfs: { kind: "snapshot", pathOrName: "saved" },
    process: { user: "1000" },
    lifecycle: { logLevel: "debug" },
    network: { ports: [{ hostPort: 8123, guestPort: 123, protocol: "udp", bindAddress: "127.0.0.1" }] },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(calls, [
    ["source", "saved"], ["name", "child"], ["user", "1000"], ["logLevel", "debug"],
    ["portUdpBind", "127.0.0.1", 8123, 123], ["restore"], ["detach"],
  ]);
});

test("snapshot input rejects unsupported options before any SDK operation", async (t) => {
  t.mock.method(Sandbox, "restore", () => { throw new Error("unexpected SDK call"); });
  t.mock.method(Sandbox, "builder", () => { throw new Error("unexpected SDK call"); });
  const create = tool("sandbox_create");
  for (const options of [
    { memoryMib: 256 }, { image: "alpine" }, { patches: [] },
    { process: { env: { TOKEN: "keep-private" } } },
    { lifecycle: { replace: true } }, { network: { disabled: true } },
  ]) {
    const result = await create({ name: "child", rootfs: { kind: "snapshot", pathOrName: "saved" }, ...options });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /snapshot restore does not support create-only options/);
    assert.doesNotMatch(JSON.stringify(result), /keep-private/);
  }
});

test("a failed restore is returned without retrying as a fresh boot", async (t) => {
  const builder = { name() { return this; }, restore: async () => { throw new Error("unsupported checkpoint restore; upgrade msb"); } };
  t.mock.method(Sandbox, "restore", () => builder);
  t.mock.method(Sandbox, "builder", () => { throw new Error("unexpected boot fallback"); });
  const result = await tool("sandbox_create")({ name: "child", rootfs: { kind: "snapshot", pathOrName: "saved" } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /upgrade msb/);
});
