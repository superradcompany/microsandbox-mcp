import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, type LogEntry, type LogReadSource } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { compactTruncations, limitText, type Truncation } from "../utils/output.js";
import { ok } from "../utils/response.js";
import { parseDate, toIso } from "../utils/serialization.js";

const logSourceSchema = z.enum(["stdout", "stderr", "output", "system", "all"]);

const logFilterSchema = z.object({
  name: z.string().describe("Sandbox name"),
  tail: z.number().int().positive().optional().describe("Return only the last N matching entries"),
  since: z.string().optional().describe("Inclusive ISO timestamp lower bound"),
  until: z.string().optional().describe("Exclusive ISO timestamp upper bound"),
  sources: z.array(logSourceSchema).optional().describe("Log sources to include"),
  grep: z.string().optional().describe("Substring filter applied to decoded text"),
  sessionIds: z.array(z.number().int().nonnegative()).optional().describe("Exec session ids to include"),
  maxBytes: z.number().int().positive().optional().describe("Maximum bytes to return per log entry"),
});

export function registerLogTools(server: McpServer): void {
  server.registerTool(
    "sandbox_logs_read",
    {
      title: "Read Sandbox Logs",
      description: "Read captured sandbox exec logs with source, time, grep, and session filters.",
      inputSchema: logFilterSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      try {
        const handle = await Sandbox.get(args.name);
        const entries = await handle.logs({
          tail: args.tail,
          since: parseDate(args.since),
          until: parseDate(args.until),
          sources: args.sources as LogReadSource[] | undefined,
        });
        const { entries: filtered, truncated } = filterAndSerialize(entries, args);
        return ok({ entries: filtered, nextCursor: nextCursor(entries) }, { truncated });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_logs_stream",
    {
      title: "Poll Sandbox Log Stream",
      description: "Poll captured sandbox logs with a cursor and bounded follow timeout.",
      inputSchema: logFilterSchema.omit({ tail: true }).extend({
        fromCursor: z.string().optional().describe("Opaque cursor from a previous log entry"),
        follow: z.boolean().optional().describe("Wait for new entries after current EOF"),
        followTimeoutMs: z.number().int().nonnegative().optional().describe("Maximum time to wait for followed entries"),
        limit: z.number().int().positive().max(1000).optional().describe("Maximum entries to return"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      let stream: Awaited<ReturnType<Awaited<ReturnType<typeof Sandbox.get>>["logStream"]>> | undefined;
      try {
        const handle = await Sandbox.get(args.name);
        stream = await handle.logStream({
          since: parseDate(args.since),
          until: parseDate(args.until),
          fromCursor: args.fromCursor,
          follow: args.follow,
          sources: args.sources as LogReadSource[] | undefined,
        });

        const entries = [];
        const deadline = Date.now() + (args.followTimeoutMs ?? 0);
        for (let i = 0; i < (args.limit ?? 100); i += 1) {
          const entry = args.follow
            ? await recvWithTimeout(stream, Math.max(0, deadline - Date.now()))
            : await stream.recv();
          if (!entry) break;
          entries.push(entry);
        }

        const { entries: filtered, truncated } = filterAndSerialize(entries, args);
        return ok({
          entries: filtered,
          nextCursor: nextCursor(entries),
        }, { truncated });
      } catch (error) {
        return formatError(error);
      } finally {
        if (stream) await stream[Symbol.asyncDispose]();
      }
    },
  );
}

function filterAndSerialize(
  entries: LogEntry[],
  args: { grep?: string; sessionIds?: number[]; maxBytes?: number },
): { entries: Record<string, unknown>[]; truncated?: Truncation[] } {
  const truncations: Truncation[] = [];
  const filtered = entries
    .filter((entry) => args.sessionIds ? entry.sessionId !== null && args.sessionIds.includes(entry.sessionId) : true)
    .filter((entry) => args.grep ? entry.text().includes(args.grep) : true)
    .map((entry, index) => serializeLogEntry(entry, index, args.maxBytes, truncations));

  return {
    entries: filtered,
    truncated: compactTruncations(truncations),
  };
}

function serializeLogEntry(
  entry: LogEntry,
  index: number,
  maxBytes: number | undefined,
  truncated: Truncation[],
): Record<string, unknown> {
  const text = limitText(entry.text(), `entries.${index}.text`, maxBytes);
  if (text.truncated) truncated.push(text.truncated);
  return {
    timestamp: toIso(entry.timestamp),
    source: entry.source,
    sessionId: entry.sessionId,
    text: text.text,
    cursor: entry.cursor,
  };
}

async function recvWithTimeout(
  stream: Awaited<ReturnType<Awaited<ReturnType<typeof Sandbox.get>>["logStream"]>>,
  timeoutMs: number,
): Promise<LogEntry | null> {
  if (timeoutMs <= 0) return null;
  return await Promise.race([
    stream.recv(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function nextCursor(entries: LogEntry[]): string | null {
  return entries.length > 0 ? entries[entries.length - 1]!.cursor : null;
}
