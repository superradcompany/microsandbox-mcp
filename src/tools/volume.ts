import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Volume } from "microsandbox";
import { formatError } from "../utils/errors.js";

export function registerVolumeTools(server: McpServer): void {
  server.registerTool(
    "volume_create",
    {
      title: "Create Volume",
      description:
        "Create a named persistent volume. Volumes survive sandbox restarts and can be shared across sandboxes.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        sizeMib: z.number().int().min(1).optional().describe("Quota in MiB"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, sizeMib }) => {
      try {
        const config = {
          name,
          ...(sizeMib && { quotaMib: sizeMib }),
        };
        await Volume.create(config);
        return {
          content: [{ type: "text", text: JSON.stringify({ name, created: true }, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_list",
    {
      title: "List Volumes",
      description: "List all named volumes.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const handles = await Volume.list();
        const results = handles.map((h) => ({
          name: h.name,
          quotaMib: h.quotaMib,
          usedBytes: h.usedBytes,
          createdAt: h.createdAt,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_remove",
    {
      title: "Remove Volume",
      description: "Remove a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      try {
        await Volume.remove(name);
        return {
          content: [{ type: "text", text: JSON.stringify({ name, removed: true }, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
