import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resetServerConfigForTests } from "../dist/config.js";
import { PolicyError, assertHostPathAllowed } from "../dist/utils/policy.js";

test("host path allowlist accepts paths under configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "microsandbox-mcp-policy-"));
  const child = path.join(root, "child.txt");
  fs.writeFileSync(child, "ok");

  process.env.MICROSANDBOX_MCP_HOST_PATHS = fs.realpathSync.native(root);
  process.env.MICROSANDBOX_MCP_HOST_PATH_POLICY = "allowlist";
  resetServerConfigForTests();

  assert.equal(assertHostPathAllowed(child), fs.realpathSync.native(child));
});

test("host path allowlist rejects paths outside configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "microsandbox-mcp-policy-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "microsandbox-mcp-outside-"));

  process.env.MICROSANDBOX_MCP_HOST_PATHS = fs.realpathSync.native(root);
  process.env.MICROSANDBOX_MCP_HOST_PATH_POLICY = "allowlist";
  resetServerConfigForTests();

  assert.throws(() => assertHostPathAllowed(outside), PolicyError);
});
