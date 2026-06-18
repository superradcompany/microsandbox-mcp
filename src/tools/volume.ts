import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Volume } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { limitText, type Truncation } from "../utils/output.js";
import { ok } from "../utils/response.js";
import { fsEntryData, fsMetadataData, volumeHandleData } from "../utils/serialization.js";

const encodingSchema = z.enum(["utf8", "base64"]);

export function registerVolumeTools(server: McpServer): void {
  server.registerTool(
    "volume_create",
    {
      title: "Create Volume",
      description: "Create a directory or disk-backed named persistent volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        kind: z.enum(["directory", "disk"]).optional().describe("Volume kind. Defaults to directory."),
        sizeMib: z.number().int().min(1).optional().describe("Disk capacity in MiB for disk-backed volumes"),
        quotaMib: z.number().int().min(1).optional().describe("Quota in MiB"),
        labels: z.record(z.string(), z.string()).optional().describe("Volume labels"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, kind, sizeMib, quotaMib, labels }) => {
      try {
        let builder = Volume.builder(name);
        builder = kind === "disk" ? builder.disk() : builder.directory();
        if (typeof sizeMib === "number") builder = builder.size(sizeMib);
        if (typeof quotaMib === "number") builder = builder.quota(quotaMib);
        for (const [key, value] of Object.entries(labels ?? {})) {
          builder = builder.label(key, value);
        }
        await builder.create();
        return ok(volumeHandleData(await Volume.get(name)));
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
        return ok(handles.map(volumeHandleData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_inspect",
    {
      title: "Inspect Volume",
      description: "Inspect one named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      try {
        return ok(volumeHandleData(await Volume.get(name)));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_remove",
    {
      title: "Remove Volumes",
      description: "Remove one or more named volumes.",
      inputSchema: z.object({
        name: z.string().optional().describe("Volume name"),
        names: z.array(z.string()).optional().describe("Volume names"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name, names }) => {
      try {
        const targets = [...(name ? [name] : []), ...(names ?? [])];
        if (targets.length === 0) throw new Error("volume_remove requires name or names");
        const results = [];
        for (const target of targets) {
          await Volume.remove(target);
          results.push({ name: target, removed: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_read",
    {
      title: "Read Volume File",
      description: "Read a file from a named volume as UTF-8 text or base64 bytes.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Path inside the volume"),
        encoding: encodingSchema.optional().describe("Output encoding. Defaults to utf8."),
        maxBytes: z.number().int().positive().optional().describe("Maximum bytes to return"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path, encoding, maxBytes }) => {
      try {
        const fs = await volumeFs(name);
        if ((encoding ?? "utf8") === "base64") {
          const data = await fs.read(path);
          const result = encodeBytes(data, "content", maxBytes);
          return ok({ name, path, encoding: "base64", content: result.content }, {
            truncated: result.truncated ? [result.truncated] : undefined,
          });
        }

        const content = await fs.readToString(path);
        const limited = limitText(content, "content", maxBytes);
        return ok({ name, path, encoding: "utf8", content: limited.text }, {
          truncated: limited.truncated ? [limited.truncated] : undefined,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_write",
    {
      title: "Write Volume File",
      description: "Write UTF-8 text or base64 bytes into a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Path inside the volume"),
        content: z.string().describe("Content to write"),
        encoding: encodingSchema.optional().describe("Input encoding. Defaults to utf8."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path, content, encoding }) => {
      try {
        const data = (encoding ?? "utf8") === "base64" ? Buffer.from(content, "base64") : content;
        const fs = await volumeFs(name);
        await fs.write(path, data);
        return ok({ name, path, encoding: encoding ?? "utf8", written: Buffer.byteLength(data) });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_list",
    {
      title: "List Volume Directory",
      description: "List entries inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Directory path inside the volume"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await volumeFs(name);
        return ok((await fs.list(path)).map(fsEntryData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_mkdir",
    {
      title: "Create Volume Directory",
      description: "Create a directory inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Directory path inside the volume"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await volumeFs(name);
        await fs.mkdir(path);
        return ok({ name, path, created: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_remove",
    {
      title: "Remove Volume Path",
      description: "Remove a file or directory from a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Path inside the volume"),
        kind: z.enum(["auto", "file", "dir"]).optional().describe("Removal kind. Defaults to auto."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name, path, kind }) => {
      try {
        const fs = await volumeFs(name);
        if (kind === "dir") await fs.removeDir(path);
        else if (kind === "file") await fs.remove(path);
        else {
          try {
            await fs.remove(path);
          } catch {
            await fs.removeDir(path);
          }
        }
        return ok({ name, path, removed: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_copy",
    {
      title: "Copy Volume Path",
      description: "Copy a file inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        from: z.string().describe("Source path"),
        to: z.string().describe("Destination path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, from, to }) => {
      try {
        const fs = await volumeFs(name);
        await fs.copy(from, to);
        return ok({ name, from, to, copied: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_rename",
    {
      title: "Rename Volume Path",
      description: "Rename a file or directory inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        from: z.string().describe("Old path"),
        to: z.string().describe("New path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, from, to }) => {
      try {
        const fs = await volumeFs(name);
        await fs.rename(from, to);
        return ok({ name, from, to, renamed: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_stat",
    {
      title: "Stat Volume Path",
      description: "Get metadata for a path inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Path inside the volume"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await volumeFs(name);
        return ok(fsMetadataData(await fs.stat(path)));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "volume_fs_exists",
    {
      title: "Check Volume Path Exists",
      description: "Check whether a path exists inside a named volume.",
      inputSchema: z.object({
        name: z.string().describe("Volume name"),
        path: z.string().describe("Path inside the volume"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await volumeFs(name);
        return ok({ name, path, exists: await fs.exists(path) });
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

async function volumeFs(name: string) {
  return (await Volume.get(name)).fs();
}

function encodeBytes(data: Uint8Array, field: string, maxBytes?: number): {
  content: string;
  truncated?: Truncation;
} {
  const totalBytes = data.byteLength;
  const returnedBytes = maxBytes && totalBytes > maxBytes ? maxBytes : totalBytes;
  const content = Buffer.from(data.subarray(0, returnedBytes)).toString("base64");
  return {
    content,
    truncated: returnedBytes < totalBytes ? { field, returnedBytes, totalBytes } : undefined,
  };
}
