import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const msbName = process.platform === "win32" ? "msb.exe" : "msb";
const firmwareName = process.platform === "win32" ? "libkrunfw.dll" : process.platform === "darwin" ? "libkrunfw.5.dylib" : "libkrunfw.so.5.6.1";

// A child process isolates the SDK's process-wide runtime registration and home.
// The fixture binaries must never execute: ensure should only resolve the pair.
function runRuntimeTools(home) {
  const env = { ...process.env, MSB_HOME: home, MSB_CONFIG_PATH: path.join(home, "absent-config.json") };
  delete env.MSB_PATH;
  delete env.MSB_LIBKRUNFW_PATH;
  const script = `
    import { registerRuntimeTools } from ${JSON.stringify(new URL("../dist/tools/runtime.js", import.meta.url).href)};
    import { registerResources } from ${JSON.stringify(new URL("../dist/resources.js", import.meta.url).href)};
    const tools = new Map();
    const resources = new Map();
    const server = { registerTool: (n, c, h) => tools.set(n, h), registerResource: (n, u, c, h) => resources.set(n, h) };
    registerRuntimeTools(server);
    registerResources(server);
    console.log(JSON.stringify({check: await tools.get("runtime_check")(), install: await tools.get("runtime_install")(), resource: await resources.get("runtime")(new URL("microsandbox://runtime"))}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("runtime tools reuse a complete home pair without installation", () => {
  const home = mkdtempSync(path.join(tmpdir(), "mcp-runtime-"));
  try {
    mkdirSync(path.join(home, "bin"));
    mkdirSync(path.join(home, "lib"));
    const executable = path.join(home, "bin", msbName);
    const firmware = path.join(home, "lib", firmwareName);
    writeFileSync(executable, "fixture executable", { mode: 0o755 });
    writeFileSync(firmware, "fixture firmware");
    const result = runRuntimeTools(home);
    assert.notEqual(result.check.isError, true, JSON.stringify(result.check));
    assert.notEqual(result.install.isError, true, JSON.stringify(result.install));
    assert.equal(JSON.parse(result.resource.contents[0].text).installed, true);
    assert.equal(readFileSync(executable, "utf8"), "fixture executable");
    assert.equal(readFileSync(firmware, "utf8"), "fixture firmware");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("runtime installation reports an incomplete home instead of replacing it", () => {
  const home = mkdtempSync(path.join(tmpdir(), "mcp-runtime-"));
  try {
    mkdirSync(path.join(home, "bin"));
    const executable = path.join(home, "bin", msbName);
    writeFileSync(executable, "fixture executable", { mode: 0o755 });
    const result = runRuntimeTools(home);
    assert.equal(result.install.isError, true);
    assert.match(JSON.stringify(result.install), /expected both/);
    assert.equal(readFileSync(executable, "utf8"), "fixture executable");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
