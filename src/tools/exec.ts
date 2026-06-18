import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, type Sandbox as SandboxInstance } from "microsandbox";

import {
  closeExecSession,
  createExecSession,
  killExecSession,
  pollExecSession,
  signalExecSession,
  writeExecSessionStdin,
} from "../state/exec-sessions.js";
import { formatError } from "../utils/errors.js";
import { formatExecOutput } from "../utils/exec-output.js";
import { compactTruncations, limitText, type Truncation } from "../utils/output.js";
import { fail, ok } from "../utils/response.js";

const rlimitSchema = z.object({
  resource: z.string(),
  soft: z.number().int().nonnegative(),
  hard: z.number().int().nonnegative().optional(),
});

const execOptionsSchema = z.object({
  name: z.string().describe("Sandbox name"),
  command: z.string().describe("Command to execute"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  cwd: z.string().optional().describe("Working directory override"),
  workdir: z.string().optional().describe("Working directory override"),
  env: z.record(z.string(), z.string()).optional().describe("Additional environment variables"),
  user: z.string().optional().describe("Guest user override"),
  tty: z.boolean().optional().describe("Allocate a TTY"),
  timeout: z.number().optional().describe("Timeout in seconds"),
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds"),
  rlimits: z.array(rlimitSchema).optional().describe("Process rlimits"),
  stdin: z.string().optional().describe("UTF-8 stdin to write before waiting"),
  stdinBase64: z.string().optional().describe("Base64 stdin bytes to write before waiting"),
  maxBytes: z.number().int().positive().optional().describe("Maximum stdout/stderr bytes to return"),
  startIfStopped: z.boolean().optional().describe("Start a stopped sandbox for this command"),
  keepRunning: z.boolean().optional().describe("Keep a sandbox running when startIfStopped starts it"),
  treatNonZeroAsError: z.boolean().optional().describe("Return a tool error when exit code is non-zero"),
});

export function registerExecTools(server: McpServer): void {
  server.registerTool(
    "sandbox_exec",
    {
      title: "Execute Command in Sandbox",
      description: "Execute a command inside a running sandbox and return stdout/stderr/exit code.",
      inputSchema: execOptionsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      const context = await openSandboxForExec(args.name, args.startIfStopped, args.keepRunning);
      try {
        const output = await context.sandbox.execWith(args.command, (b) => applyExecOptions(b, args));
        const result = formatExecOutput(output, args.maxBytes);
        if (args.treatNonZeroAsError && !result.data.success) {
          return fail("exec_failed", `command exited with status ${result.data.exitCode}`, {
            details: result.data,
          });
        }
        return ok(result.data, {
          truncated: result.truncated,
          warnings: context.warning ? [context.warning] : undefined,
        });
      } catch (error) {
        return formatError(error);
      } finally {
        await stopIfNeeded(context);
      }
    },
  );

  server.registerTool(
    "sandbox_shell",
    {
      title: "Run Shell Command in Sandbox",
      description: "Execute a shell command or script string inside a running sandbox.",
      inputSchema: execOptionsSchema.omit({ args: true }).extend({
        shell: z.string().optional().describe("Shell binary to execute. Defaults to sh."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      const context = await openSandboxForExec(args.name, args.startIfStopped, args.keepRunning);
      try {
        const shell = args.shell ?? "sh";
        const output = await context.sandbox.execWith(shell, (b) =>
          applyExecOptions(b.args(["-c", args.command]), args),
        );
        const result = formatExecOutput(output, args.maxBytes);
        if (args.treatNonZeroAsError && !result.data.success) {
          return fail("exec_failed", `shell command exited with status ${result.data.exitCode}`, {
            details: result.data,
          });
        }
        return ok(result.data, {
          truncated: result.truncated,
          warnings: context.warning ? [context.warning] : undefined,
        });
      } catch (error) {
        return formatError(error);
      } finally {
        await stopIfNeeded(context);
      }
    },
  );

  server.registerTool(
    "sandbox_exec_start",
    {
      title: "Start Exec Session",
      description: "Start a long-running command and return an exec session id for polling and stdin.",
      inputSchema: execOptionsSchema.extend({
        shell: z.boolean().optional().describe("Interpret command as a shell script with sh -c"),
        closeStdin: z.boolean().optional().describe("Close stdin after writing the initial stdin payload"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      try {
        const context = await openSandboxForExec(args.name, args.startIfStopped, args.keepRunning);
        const stopSandboxOnExit = context.stopAfter ? args.name : null;
        const handle = args.shell
          ? await context.sandbox.execStreamWith("sh", (b) =>
            applyExecOptions(b.args(["-c", args.command]), args, true),
          )
          : await context.sandbox.execStreamWith(args.command, (b) => applyExecOptions(b, args, true));
        const execSessionId = await createExecSession(handle, { stopSandboxOnExit });
        const initialStdin = stdinPayload(args);
        if (initialStdin !== undefined) {
          await writeExecSessionStdin(execSessionId, initialStdin, args.closeStdin);
        }
        return ok({
          execSessionId,
          sandbox: args.name,
          stopSandboxOnExit,
        }, {
          warnings: context.warning ? [context.warning] : undefined,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_exec_poll",
    {
      title: "Poll Exec Session",
      description: "Read output events and status from a long-running exec session.",
      inputSchema: z.object({
        execSessionId: z.string(),
        cursor: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        maxBytes: z.number().int().positive().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ execSessionId, cursor, limit, maxBytes }) => {
      try {
        const polled = pollExecSession(execSessionId, cursor, limit);
        const truncated: Truncation[] = [];
        const events = polled.events.map((entry) => ({
          ...entry,
          event: limitExecEvent(entry.event, maxBytes, truncated),
        }));
        return ok({
          events,
          nextCursor: polled.nextCursor,
          done: polled.done,
          exitStatus: polled.exitStatus,
          error: polled.error,
        }, {
          truncated: compactTruncations(truncated),
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_exec_write_stdin",
    {
      title: "Write Exec Stdin",
      description: "Write UTF-8 or base64 data to an exec session's stdin.",
      inputSchema: z.object({
        execSessionId: z.string(),
        data: z.string().optional(),
        dataBase64: z.string().optional(),
        close: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ execSessionId, data, dataBase64, close }) => {
      try {
        const payload = dataBase64 ? Buffer.from(dataBase64, "base64") : (data ?? "");
        await writeExecSessionStdin(execSessionId, payload, close);
        return ok({ execSessionId, written: Buffer.byteLength(payload), stdinClosed: close === true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_exec_signal",
    {
      title: "Signal Exec Session",
      description: "Send a POSIX signal to an exec session process.",
      inputSchema: z.object({
        execSessionId: z.string(),
        signal: z.union([
          z.number().int().positive(),
          z.enum(["hup", "int", "term", "kill"]),
        ]),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ execSessionId, signal }) => {
      try {
        if (signal === "kill") {
          await killExecSession(execSessionId);
        } else {
          await signalExecSession(execSessionId, signalNumber(signal));
        }
        return ok({ execSessionId, signaled: signal });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_exec_close",
    {
      title: "Close Exec Session",
      description: "Close and forget an in-memory exec session.",
      inputSchema: z.object({
        execSessionId: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ execSessionId }) => {
      try {
        await closeExecSession(execSessionId);
        return ok({ execSessionId, closed: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

function applyExecOptions(
  builder: Parameters<SandboxInstance["execWith"]>[1] extends (b: infer B) => infer B ? B : never,
  args: z.infer<typeof execOptionsSchema>,
  forceStdinPipe = false,
) {
  let acc = builder;
  if (args.args) acc = acc.args(args.args);
  if (args.cwd ?? args.workdir) acc = acc.cwd(args.cwd ?? args.workdir!);
  if (args.env) acc = acc.envs(args.env);
  if (args.user) acc = acc.user(args.user);
  if (args.tty !== undefined) acc = acc.tty(args.tty);
  const timeoutMs = args.timeoutMs ?? (args.timeout ? args.timeout * 1000 : undefined);
  if (timeoutMs) acc = acc.timeout(timeoutMs);
  for (const rlimit of args.rlimits ?? []) {
    acc = acc.rlimitRange(rlimit.resource, rlimit.soft, rlimit.hard ?? rlimit.soft);
  }
  const stdin = stdinPayload(args);
  if (forceStdinPipe) acc = acc.stdinPipe();
  else if (stdin !== undefined) acc = acc.stdinBytes(Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin, "utf8"));
  return acc;
}

async function openSandboxForExec(
  name: string,
  startIfStopped = false,
  keepRunning = false,
): Promise<{
  sandbox: SandboxInstance;
  stopAfter: boolean;
  warning?: string;
}> {
  const handle = await Sandbox.get(name);
  if (handle.status === "running") {
    return { sandbox: await handle.connect(), stopAfter: false };
  }
  if (!startIfStopped) {
    return { sandbox: await handle.connect(), stopAfter: false };
  }
  const sandbox = await handle.startDetached();
  return {
    sandbox,
    stopAfter: !keepRunning,
    warning: keepRunning ? undefined : "sandbox was started for this command and will be stopped afterward",
  };
}

async function stopIfNeeded(context: { sandbox: SandboxInstance; stopAfter: boolean }): Promise<void> {
  if (!context.stopAfter) return;
  try {
    await context.sandbox.stop();
  } catch {
    // Best-effort cleanup for startIfStopped one-shot commands.
  }
}

function stdinPayload(args: { stdin?: string; stdinBase64?: string }): string | Buffer | undefined {
  if (args.stdinBase64 !== undefined) return Buffer.from(args.stdinBase64, "base64");
  return args.stdin;
}

function limitExecEvent(
  event: Record<string, unknown>,
  maxBytes: number | undefined,
  truncated: Truncation[],
): Record<string, unknown> {
  if ((event.kind === "stdout" || event.kind === "stderr") && typeof event.data === "string") {
    const limited = limitText(event.data, String(event.kind), maxBytes);
    if (limited.truncated) truncated.push(limited.truncated);
    return { ...event, data: limited.text };
  }
  return event;
}

function signalNumber(signal: number | "hup" | "int" | "term" | "kill"): number {
  if (typeof signal === "number") return signal;
  switch (signal) {
    case "hup":
      return 1;
    case "int":
      return 2;
    case "term":
      return 15;
    case "kill":
      return 9;
  }
}
