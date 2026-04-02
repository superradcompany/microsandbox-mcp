import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, Mount, Patch } from "microsandbox";
import { formatError } from "../utils/errors.js";

async function waitForStopped(name: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await Sandbox.get(name);
      if (h.status !== "running") return;
    } catch {
      return; // Sandbox gone, that's fine.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function registerSandboxTools(server: McpServer): void {
  server.registerTool(
    "sandbox_run",
    {
      title: "Run Command in Ephemeral Sandbox",
      description:
        "Create an ephemeral sandbox, run a shell command, return the output, and destroy the sandbox. " +
        "Best for quick one-off tasks like running a script, checking a command, or testing code.",
      inputSchema: z.object({
        image: z.string().describe('OCI image (e.g. "python:3.12", "node:22", "alpine")'),
        command: z.string().describe("Shell command to execute"),
        memoryMib: z.number().int().min(128).optional().describe("Memory in MiB (default: 512)"),
        cpus: z.number().int().min(1).max(16).optional().describe("Number of vCPUs (default: 1)"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ image, command, memoryMib, cpus, env }) => {
      const name = `mcp-run-${Date.now()}`;
      let sandbox: Sandbox | undefined;
      try {
        sandbox = await Sandbox.create({
          name,
          image,
          memoryMib: memoryMib ?? 512,
          cpus: cpus ?? 1,
          env: env ?? {},
        });
        const output = await sandbox.shell(command);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              stdout: output.stdout(),
              stderr: output.stderr(),
              exitCode: output.code,
              success: output.success,
            }, null, 2),
          }],
        };
      } catch (error) {
        return formatError(error);
      } finally {
        if (sandbox) {
          try {
            await sandbox.stop();
            await waitForStopped(name);
            await Sandbox.remove(name);
          } catch {
            // Best-effort cleanup.
          }
        }
      }
    },
  );

  server.registerTool(
    "sandbox_create",
    {
      title: "Create Sandbox",
      description:
        "Create and boot a persistent named sandbox with full configuration. " +
        "The sandbox stays running until explicitly stopped.",
      inputSchema: z.object({
        name: z.string().describe("Unique sandbox name"),
        image: z.string().describe('OCI image reference (e.g. "python:3.12", "ubuntu:24.04")'),
        cpus: z.number().int().min(1).max(16).optional().describe("Virtual CPUs (default: 1)"),
        memoryMib: z.number().int().min(128).optional().describe("Memory in MiB (default: 512)"),
        workdir: z.string().optional().describe("Default working directory inside the sandbox"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
        volumes: z.array(z.object({
          guestPath: z.string().describe("Mount point inside sandbox"),
          type: z.enum(["bind", "named", "tmpfs"]).describe("Volume type"),
          source: z.string().optional().describe("Host path (bind) or volume name (named)"),
          readonly: z.boolean().optional().describe("Mount as read-only"),
          sizeMib: z.number().optional().describe("Size for tmpfs volumes"),
        })).optional().describe("Volume mounts"),
        patches: z.array(z.object({
          type: z.enum(["text", "mkdir", "append", "remove", "symlink"]).describe("Patch type"),
          path: z.string().describe("Target path inside sandbox"),
          content: z.string().optional().describe("File content (text, append)"),
          target: z.string().optional().describe("Symlink target"),
          mode: z.number().optional().describe("Unix permissions"),
        })).optional().describe("Rootfs modifications applied before boot"),
        entrypoint: z.array(z.string()).optional().describe("Override image entrypoint"),
        hostname: z.string().optional().describe("Guest hostname"),
        maxDuration: z.number().optional().describe("Auto-stop after N seconds"),
        idleTimeout: z.number().optional().describe("Auto-stop after N seconds of inactivity"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, image, cpus, memoryMib, workdir, env, volumes, patches, entrypoint, hostname, maxDuration, idleTimeout }) => {
      try {
        const volumeMap: Record<string, ReturnType<typeof Mount.bind> | ReturnType<typeof Mount.named> | ReturnType<typeof Mount.tmpfs>> = {};
        if (volumes) {
          for (const v of volumes) {
            switch (v.type) {
              case "bind":
                volumeMap[v.guestPath] = Mount.bind(v.source!, { readonly: v.readonly });
                break;
              case "named":
                volumeMap[v.guestPath] = Mount.named(v.source!, { readonly: v.readonly });
                break;
              case "tmpfs":
                volumeMap[v.guestPath] = Mount.tmpfs({ sizeMib: v.sizeMib });
                break;
            }
          }
        }

        const patchList = patches?.map((p) => {
          switch (p.type) {
            case "text":
              return Patch.text(p.path, p.content!, { mode: p.mode });
            case "mkdir":
              return Patch.mkdir(p.path, { mode: p.mode });
            case "append":
              return Patch.append(p.path, p.content!);
            case "remove":
              return Patch.remove(p.path);
            case "symlink":
              return Patch.symlink(p.target!, p.path);
            default:
              throw new Error(`Unknown patch type: ${p.type}`);
          }
        });

        const config = {
          name,
          image,
          cpus: cpus ?? 1,
          memoryMib: memoryMib ?? 512,
          ...(workdir && { workdir }),
          ...(env && { env }),
          ...(Object.keys(volumeMap).length > 0 && { volumes: volumeMap }),
          ...(patchList && patchList.length > 0 && { patches: patchList }),
          ...(entrypoint && { entrypoint }),
          ...(hostname && { hostname }),
          ...(maxDuration && { maxDurationSecs: maxDuration }),
        };

        await Sandbox.create(config);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ name, status: "running", image }, null, 2),
          }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_list",
    {
      title: "List Sandboxes",
      description: "List all sandboxes with their status.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const handles = await Sandbox.list();
        const results = handles.map((h) => ({
          name: h.name,
          status: h.status,
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
    "sandbox_inspect",
    {
      title: "Inspect Sandbox",
      description: "Get detailed information about a specific sandbox including full configuration.",
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
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name: handle.name,
              status: handle.status,
              config: handle.configJson,
              createdAt: handle.createdAt,
              updatedAt: handle.updatedAt,
            }, null, 2),
          }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_stop",
    {
      title: "Stop Sandbox",
      description: "Stop a running sandbox. Use force to kill with SIGKILL instead of graceful SIGTERM.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        force: z.boolean().optional().describe("Force kill with SIGKILL instead of graceful SIGTERM"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ name, force }) => {
      try {
        const handle = await Sandbox.get(name);
        if (force) {
          await handle.kill();
        } else {
          await handle.stop();
        }
        await waitForStopped(name);
        return {
          content: [{ type: "text", text: JSON.stringify({ name, status: "stopped" }, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_remove",
    {
      title: "Remove Sandbox",
      description: "Remove a sandbox. Must be stopped unless force is true.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        force: z.boolean().optional().describe("Stop and remove in one step if still running"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ name, force }) => {
      try {
        if (force) {
          try {
            const handle = await Sandbox.get(name);
            if (handle.status === "running") {
              await handle.kill();
              await waitForStopped(name);
            }
          } catch {
            // Sandbox may already be stopped or not exist.
          }
        }
        await Sandbox.remove(name);
        return {
          content: [{ type: "text", text: JSON.stringify({ name, removed: true }, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
