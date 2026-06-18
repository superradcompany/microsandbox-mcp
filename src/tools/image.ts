import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Image } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { fail, ok } from "../utils/response.js";
import { imageDetailData, imageHandleData } from "../utils/serialization.js";

export function registerImageTools(server: McpServer): void {
  server.registerTool(
    "image_list",
    {
      title: "List Cached Images",
      description: "List cached microsandbox images.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        return ok((await Image.list()).map(imageHandleData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "image_inspect",
    {
      title: "Inspect Cached Image",
      description: "Inspect cached image config and layers.",
      inputSchema: z.object({
        reference: z.string().describe("Image reference"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ reference }) => {
      try {
        return ok(imageDetailData(await Image.inspect(reference)));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "image_remove",
    {
      title: "Remove Cached Images",
      description: "Remove one or more cached images.",
      inputSchema: z.object({
        reference: z.string().optional().describe("Image reference"),
        references: z.array(z.string()).optional().describe("Image references"),
        force: z.boolean().optional().describe("Remove even when a sandbox references the image"),
        confirm: z.boolean().optional().describe("Required when force is true"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ reference, references, force, confirm }) => {
      try {
        if (force && !confirm) {
          return fail("dangerous_operation_disabled", "image_remove with force requires confirm: true");
        }
        const targets = [...(reference ? [reference] : []), ...(references ?? [])];
        if (targets.length === 0) throw new Error("image_remove requires reference or references");
        const results = [];
        for (const target of targets) {
          await Image.remove(target, { force });
          results.push({ reference: target, removed: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "image_prune",
    {
      title: "Prune Cached Images",
      description: "Remove cached image artifacts unused by sandboxes.",
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true to prune image cache data"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ confirm }) => {
      try {
        if (!confirm) {
          return fail("dangerous_operation_disabled", "image_prune requires confirm: true");
        }
        return ok(await Image.prune());
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
