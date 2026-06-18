import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { limitText, type Truncation } from "../utils/output.js";
import { assertHostPathAllowed } from "../utils/policy.js";
import { ok } from "../utils/response.js";
import { fsEntryData, fsMetadataData } from "../utils/serialization.js";

const encodingSchema = z.enum(["utf8", "base64"]);

export function registerFilesystemTools(server: McpServer): void {
  server.registerTool(
    "sandbox_fs_read",
    {
      title: "Read File from Sandbox",
      description: "Read a file from the sandbox filesystem as UTF-8 text or base64 bytes.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Absolute path inside the sandbox"),
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
        const fs = await sandboxFs(name);
        if ((encoding ?? "utf8") === "base64") {
          const data = await fs.read(path);
          const result = encodeBytes(data, "content", maxBytes);
          return ok({ path, encoding: "base64", content: result.content }, {
            truncated: result.truncated ? [result.truncated] : undefined,
          });
        }

        const content = await fs.readToString(path);
        const limited = limitText(content, "content", maxBytes);
        return ok({ path, encoding: "utf8", content: limited.text }, {
          truncated: limited.truncated ? [limited.truncated] : undefined,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_write",
    {
      title: "Write File to Sandbox",
      description: "Write UTF-8 text or base64 bytes to a file inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Absolute path inside the sandbox"),
        content: z.string().describe("File content to write"),
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
        const fs = await sandboxFs(name);
        await fs.write(path, data);
        return ok({ path, encoding: encoding ?? "utf8", written: Buffer.byteLength(data) });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_list",
    {
      title: "List Directory in Sandbox",
      description: "List directory contents inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Directory path to list"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await sandboxFs(name);
        const entries = await fs.list(path);
        return ok(entries.map(fsEntryData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_mkdir",
    {
      title: "Create Directory in Sandbox",
      description: "Create a directory inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Directory path to create"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await sandboxFs(name);
        await fs.mkdir(path);
        return ok({ path, created: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_remove",
    {
      title: "Remove File or Directory in Sandbox",
      description: "Remove a file or directory inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Path to remove"),
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
        const fs = await sandboxFs(name);
        if (kind === "dir") await fs.removeDir(path);
        else if (kind === "file") await fs.remove(path);
        else {
          try {
            await fs.remove(path);
          } catch {
            await fs.removeDir(path);
          }
        }
        return ok({ path, removed: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_copy",
    {
      title: "Copy Sandbox Path",
      description: "Copy a file within one sandbox or between two running sandboxes.",
      inputSchema: z.object({
        name: z.string().describe("Source sandbox name"),
        from: z.string().describe("Source path in the source sandbox"),
        to: z.string().describe("Destination path"),
        toSandbox: z.string().optional().describe("Destination sandbox. Defaults to the source sandbox."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, from, to, toSandbox }) => {
      try {
        const sourceFs = await sandboxFs(name);
        if (!toSandbox || toSandbox === name) {
          await sourceFs.copy(from, to);
          return ok({ from: { sandbox: name, path: from }, to: { sandbox: name, path: to }, copied: true });
        }

        const targetFs = await sandboxFs(toSandbox);
        const data = await sourceFs.read(from);
        await targetFs.write(to, data);
        return ok({
          from: { sandbox: name, path: from },
          to: { sandbox: toSandbox, path: to },
          copied: true,
          bytes: data.byteLength,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_rename",
    {
      title: "Rename Sandbox Path",
      description: "Rename a file or directory inside one sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
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
        const fs = await sandboxFs(name);
        await fs.rename(from, to);
        return ok({ from, to, renamed: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_stat",
    {
      title: "Get File Metadata in Sandbox",
      description: "Get file or directory metadata inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Path to stat"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await sandboxFs(name);
        const meta = await fs.stat(path);
        return ok(fsMetadataData(meta));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_exists",
    {
      title: "Check Sandbox Path Exists",
      description: "Check whether a path exists inside the sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Path to check"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const fs = await sandboxFs(name);
        return ok({ path, exists: await fs.exists(path) });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_copy_from_host",
    {
      title: "Copy Host Path Into Sandbox",
      description: "Copy an allowlisted host path into a sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        hostPath: z.string().describe("Host path to copy from"),
        guestPath: z.string().describe("Guest destination path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, hostPath, guestPath }) => {
      try {
        const fs = await sandboxFs(name);
        const allowedHostPath = assertHostPathAllowed(hostPath);
        await fs.copyFromHost(allowedHostPath, guestPath);
        return ok({ hostPath: allowedHostPath, guestPath, copied: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_copy_to_host",
    {
      title: "Copy Sandbox Path To Host",
      description: "Copy a sandbox file to an allowlisted host path.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        guestPath: z.string().describe("Guest source path"),
        hostPath: z.string().describe("Host destination path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, guestPath, hostPath }) => {
      try {
        const fs = await sandboxFs(name);
        const allowedHostPath = assertHostPathAllowed(hostPath);
        await fs.copyToHost(guestPath, allowedHostPath);
        return ok({ guestPath, hostPath: allowedHostPath, copied: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

async function sandboxFs(name: string) {
  const handle = await Sandbox.get(name);
  const sandbox = await handle.connect();
  return sandbox.fs();
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
