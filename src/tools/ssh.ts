import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, type SshClient } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { compactTruncations, limitText, type Truncation } from "../utils/output.js";
import { ok } from "../utils/response.js";

const encodingSchema = z.enum(["utf8", "base64"]);

const sshClientSchema = z.object({
  name: z.string().describe("Sandbox name"),
  user: z.string().optional().describe("SSH user"),
  term: z.string().optional().describe("Terminal type"),
});

export function registerSshTools(server: McpServer): void {
  server.registerTool(
    "sandbox_ssh_exec",
    {
      title: "Execute Command Over Sandbox SSH",
      description: "Execute a command through the sandbox SSH subsystem.",
      inputSchema: sshClientSchema.extend({
        command: z.string().describe("Command to execute"),
        tty: z.boolean().optional().describe("Allocate a TTY"),
        maxBytes: z.number().int().positive().optional().describe("Maximum stdout/stderr bytes to return"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, user, term, command, tty, maxBytes }) => {
      let client: SshClient | undefined;
      try {
        client = await openSshClient(name, { user, term });
        const output = await client.exec(command, { tty });
        const stdout = limitText(output.stdout.toString("utf8"), "stdout", maxBytes);
        const stderr = limitText(output.stderr.toString("utf8"), "stderr", maxBytes);
        return ok({
          status: output.status,
          success: output.status === 0,
          stdout: stdout.text,
          stderr: stderr.text,
        }, {
          truncated: compactTruncations([stdout.truncated, stderr.truncated]),
        });
      } catch (error) {
        return formatError(error);
      } finally {
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_read",
    {
      title: "Read File Over Sandbox SFTP",
      description: "Read a file through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Path to read"),
        encoding: encodingSchema.optional().describe("Output encoding. Defaults to utf8."),
        maxBytes: z.number().int().positive().optional().describe("Maximum bytes to return"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path, encoding, maxBytes }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        const data = await sftp.read(path);
        if ((encoding ?? "utf8") === "base64") {
          const encoded = encodeBytes(data, "content", maxBytes);
          return ok({ path, encoding: "base64", content: encoded.content }, {
            truncated: encoded.truncated ? [encoded.truncated] : undefined,
          });
        }

        const limited = limitText(data.toString("utf8"), "content", maxBytes);
        return ok({ path, encoding: "utf8", content: limited.text }, {
          truncated: limited.truncated ? [limited.truncated] : undefined,
        });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_write",
    {
      title: "Write File Over Sandbox SFTP",
      description: "Write a file through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Path to write"),
        content: z.string().describe("Content to write"),
        encoding: encodingSchema.optional().describe("Input encoding. Defaults to utf8."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path, content, encoding }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        const data = (encoding ?? "utf8") === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
        await sftp.write(path, data);
        return ok({ path, encoding: encoding ?? "utf8", written: data.byteLength });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_mkdir",
    {
      title: "Create Directory Over Sandbox SFTP",
      description: "Create a directory through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Directory path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        await sftp.mkdir(path);
        return ok({ path, created: true });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_remove",
    {
      title: "Remove Path Over Sandbox SFTP",
      description: "Remove a file or directory through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Path to remove"),
        kind: z.enum(["file", "dir"]).describe("Whether to remove a file or directory"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path, kind }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        if (kind === "dir") await sftp.removeDir(path);
        else await sftp.removeFile(path);
        return ok({ path, removed: true });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_rename",
    {
      title: "Rename Path Over Sandbox SFTP",
      description: "Rename a path through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        from: z.string().describe("Old path"),
        to: z.string().describe("New path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, user, term, from, to }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        await sftp.rename(from, to);
        return ok({ from, to, renamed: true });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_realpath",
    {
      title: "Resolve SFTP Real Path",
      description: "Resolve a path through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Path to resolve"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        return ok({ path, realPath: await sftp.realPath(path) });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_readlink",
    {
      title: "Read SFTP Symlink",
      description: "Read a symlink target through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        path: z.string().describe("Symlink path"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name, user, term, path }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        return ok({ path, target: await sftp.readLink(path) });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );

  server.registerTool(
    "sandbox_sftp_symlink",
    {
      title: "Create SFTP Symlink",
      description: "Create a symlink through the sandbox SSH/SFTP subsystem.",
      inputSchema: sshClientSchema.extend({
        target: z.string().describe("Symlink target"),
        linkPath: z.string().describe("Symlink path"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, user, term, target, linkPath }) => {
      let client: SshClient | undefined;
      let sftp: Awaited<ReturnType<SshClient["sftp"]>> | undefined;
      try {
        client = await openSshClient(name, { user, term, sftp: true });
        sftp = await client.sftp();
        await sftp.symlink(target, linkPath);
        return ok({ target, linkPath, created: true });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sftp) await sftp.close();
        if (client) await client.close();
      }
    },
  );
}

async function openSshClient(
  name: string,
  options: { user?: string; term?: string; sftp?: boolean },
): Promise<SshClient> {
  const handle = await Sandbox.get(name);
  const sandbox = await handle.connect();
  return sandbox.ssh().openClient(options);
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
