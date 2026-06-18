import fs from "node:fs";
import path from "node:path";

import { getServerConfig } from "../config.js";
import { fail, type ToolResult } from "./response.js";

export class PolicyError extends Error {
  readonly code = "host_path_denied";

  constructor(message: string, readonly path: string) {
    super(message);
  }
}

export function assertHostPathAllowed(rawPath: string): string {
  const config = getServerConfig();
  const resolved = resolveExistingAware(rawPath);

  if (config.hostPathPolicy === "unrestricted") {
    return resolved;
  }

  const allowed = config.hostPaths.some((allowedPath) => isWithinPath(resolved, allowedPath));
  if (!allowed) {
    throw new PolicyError("host path is outside MICROSANDBOX_MCP_HOST_PATHS", resolved);
  }

  return resolved;
}

export function formatPolicyError(error: PolicyError): ToolResult {
  return fail(error.code, error.message, { details: { path: error.path } });
}

function resolveExistingAware(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    try {
      return path.join(fs.realpathSync.native(parent), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

function isWithinPath(candidate: string, allowedPath: string): boolean {
  const relative = path.relative(allowedPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
