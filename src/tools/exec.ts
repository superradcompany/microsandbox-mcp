import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox } from "microsandbox";
import { formatError } from "../utils/errors.js";

export function registerExecTools(server: McpServer): void {
  server.registerTool(
    "sandbox_exec",
    {
      title: "Execute Command in Sandbox",
      description: "Execute a command inside a running sandbox and return stdout/stderr/exit code.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        command: z.string().describe("Command to execute"),
        args: z.array(z.string()).optional().describe("Command arguments"),
        cwd: z.string().optional().describe("Working directory override"),
        env: z.record(z.string(), z.string()).optional().describe("Additional environment variables"),
        timeout: z.number().optional().describe("Timeout in seconds"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, command, args, cwd, env, timeout }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();

        const output = await sandbox.execWith(command, (b) => {
          let acc = b;
          if (args) acc = acc.args(args);
          if (cwd) acc = acc.cwd(cwd);
          if (env) acc = acc.envs(env);
          if (timeout) acc = acc.timeout(timeout * 1000);
          return acc;
        });

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
      }
    },
  );

  server.registerTool(
    "sandbox_shell",
    {
      title: "Run Shell Command in Sandbox",
      description:
        "Execute a shell command or script string inside a running sandbox. " +
        "Interprets pipes, redirects, and shell syntax.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        command: z.string().describe("Shell command or script to execute"),
        timeout: z.number().optional().describe("Timeout in seconds"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, command, timeout }) => {
      try {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();

        let output;
        if (timeout) {
          output = await sandbox.execWith("sh", (b) =>
            b.args(["-c", command]).timeout(timeout * 1000),
          );
        } else {
          output = await sandbox.shell(command);
        }

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
      }
    },
  );
}
