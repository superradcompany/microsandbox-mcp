import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureRuntime, isRuntimeInstalled } from "microsandbox";

import { getServerConfig } from "../config.js";
import { emptySchema } from "../schemas/common.js";
import { formatError } from "../utils/errors.js";
import { ok } from "../utils/response.js";

const SERVER_VERSION = "0.7.3";

export function registerRuntimeTools(server: McpServer): void {
  server.registerTool(
    "runtime_check",
    {
      title: "Check Runtime Installation",
      description: "Check whether the microsandbox runtime dependencies are installed.",
      inputSchema: emptySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const config = getServerConfig();
        return ok({
          installed: isRuntimeInstalled(),
          serverVersion: SERVER_VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          msbPath: process.env.MSB_PATH ?? null,
          libkrunfwPath: process.env.MSB_LIBKRUNFW_PATH ?? null,
          hostPathPolicy: config.hostPathPolicy,
          hostPaths: config.hostPaths,
          dangerousEnabled: config.dangerousEnabled,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "runtime_install",
    {
      title: "Install Runtime Dependencies",
      description: "Install msb and libkrunfw using the microsandbox SDK installer.",
      inputSchema: emptySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        // Preserve home-first resolution and let ensure report incomplete installations.
        await ensureRuntime();

        return ok({
          installed: isRuntimeInstalled(),
          message: "Runtime dependencies are installed.",
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
