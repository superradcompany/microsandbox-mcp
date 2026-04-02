import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox } from "microsandbox";
import { formatError } from "../utils/errors.js";

export function registerFilesystemTools(server: McpServer): void {
  server.registerTool(
    "sandbox_fs_read",
    {
      title: "Read File from Sandbox",
      description: "Read a file from the sandbox filesystem and return its contents as text.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Absolute path inside the sandbox"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        const content = await sandbox.fs().readString(path);
        return {
          content: [{ type: "text", text: content }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_write",
    {
      title: "Write File to Sandbox",
      description: "Write content to a file inside the sandbox. Creates parent directories as needed.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        path: z.string().describe("Absolute path inside the sandbox"),
        content: z.string().describe("File content to write"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, path, content }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        await sandbox.fs().write(path, Buffer.from(content));
        return {
          content: [{ type: "text", text: JSON.stringify({ path, written: true }, null, 2) }],
        };
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
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        const entries = await sandbox.fs().list(path);
        const results = entries.map((e: { path: string; kind: string; size: number }) => ({
          path: e.path,
          kind: e.kind,
          size: e.size,
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
    "sandbox_fs_mkdir",
    {
      title: "Create Directory in Sandbox",
      description: "Create a directory with parent directories inside the sandbox.",
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
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        await sandbox.fs().mkdir(path);
        return {
          content: [{ type: "text", text: JSON.stringify({ path, created: true }, null, 2) }],
        };
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
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name, path }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        try {
          await sandbox.fs().remove(path);
        } catch {
          await sandbox.fs().removeDir(path);
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ path, removed: true }, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_fs_stat",
    {
      title: "Get File Metadata in Sandbox",
      description: "Get file or directory metadata (kind, size, mode, modified time) inside the sandbox.",
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
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        const meta = await sandbox.fs().stat(path);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              kind: meta.kind,
              size: meta.size,
              mode: meta.mode,
              modified: meta.modified,
            }, null, 2),
          }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
