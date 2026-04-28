import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, isInstalled, install } from "microsandbox";
import { formatError } from "../utils/errors.js";

export function registerMetricsTools(server: McpServer): void {
  server.registerTool(
    "check_installed",
    {
      title: "Check Installation",
      description:
        "Verify that msb and libkrunfw are available on the system. " +
        "Returns installation status. If not installed, the server can attempt to install them.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const installed = isInstalled();
        if (installed) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ installed: true }, null, 2),
            }],
          };
        }

        // Attempt automatic installation.
        try {
          await install();
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                installed: true,
                message: "Runtime dependencies were just installed.",
              }, null, 2),
            }],
          };
        } catch (installError) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                installed: false,
                message:
                  "msb and libkrunfw are not installed. " +
                  "Install manually: curl -fsSL https://install.microsandbox.dev | sh",
              }, null, 2),
            }],
            isError: true,
          };
        }
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_metrics",
    {
      title: "Get Sandbox Metrics",
      description: "Get live resource usage metrics (CPU, memory, disk, network) for a running sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        const m = await sandbox.metrics();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              cpuPercent: m.cpuPercent,
              memoryBytes: m.memoryBytes,
              memoryLimitBytes: m.memoryLimitBytes,
              diskReadBytes: m.diskReadBytes,
              diskWriteBytes: m.diskWriteBytes,
              netRxBytes: m.netRxBytes,
              netTxBytes: m.netTxBytes,
              uptimeSecs: m.uptimeMs ? Math.round(m.uptimeMs / 1000) : undefined,
            }, null, 2),
          }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
