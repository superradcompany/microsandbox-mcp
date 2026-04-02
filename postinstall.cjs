#!/usr/bin/env node

// Re-exports the microsandbox SDK postinstall to ensure msb + libkrunfw are available.
// The microsandbox npm package already handles this in its own postinstall, but when
// installed via npx (which may use a cache), the postinstall might not re-run.
// This script ensures the runtime dependencies are always present.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE_DIR = path.join(os.homedir(), ".microsandbox");
const BIN_DIR = path.join(BASE_DIR, "bin");
const MSB_PATH = path.join(BIN_DIR, "msb");

function isInstalled() {
  if (!fs.existsSync(MSB_PATH)) return false;
  try {
    execFileSync(MSB_PATH, ["--version"], { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!isInstalled()) {
  // Delegate to the microsandbox SDK's postinstall by requiring it directly.
  try {
    const sdkPostinstall = require.resolve("microsandbox/postinstall.js");
    require(sdkPostinstall);
  } catch {
    console.error(
      "microsandbox-mcp: msb runtime not found. Install manually:\n" +
      "  curl -fsSL https://install.microsandbox.dev | sh"
    );
    // Don't fail npm install.
  }
}
