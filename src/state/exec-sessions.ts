import crypto from "node:crypto";

import type { ExecEvent, ExecHandle, ExecSink, ExitStatus } from "microsandbox";
import { Sandbox } from "microsandbox";

import { getServerConfig } from "../config.js";

export interface StoredExecEvent {
  index: number;
  event: Record<string, unknown>;
}

interface ExecSession {
  id: string;
  handle: ExecHandle;
  stdin: ExecSink | null;
  stopSandboxOnExit: string | null;
  events: StoredExecEvent[];
  done: boolean;
  exitStatus: ExitStatus | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessions = new Map<string, ExecSession>();

export async function createExecSession(
  handle: ExecHandle,
  options: { stopSandboxOnExit?: string | null } = {},
): Promise<string> {
  cleanupExecSessions();

  const id = crypto.randomUUID();
  const stdin = await handle.takeStdin();
  const session: ExecSession = {
    id,
    handle,
    stdin,
    stopSandboxOnExit: options.stopSandboxOnExit ?? null,
    events: [],
    done: false,
    exitStatus: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  sessions.set(id, session);
  void readEvents(session);
  return id;
}

export function pollExecSession(id: string, cursor = 0, limit = 100): {
  events: StoredExecEvent[];
  nextCursor: number;
  done: boolean;
  exitStatus: ExitStatus | null;
  error: string | null;
} {
  const session = requireExecSession(id);
  touch(session);
  const events = session.events
    .filter((entry) => entry.index >= cursor)
    .slice(0, limit);
  const nextCursor = events.length > 0 ? events[events.length - 1]!.index + 1 : cursor;

  return {
    events,
    nextCursor,
    done: session.done,
    exitStatus: session.exitStatus,
    error: session.error,
  };
}

export async function writeExecSessionStdin(id: string, data: string | Uint8Array, close = false): Promise<void> {
  const session = requireExecSession(id);
  touch(session);
  if (!session.stdin) {
    throw new Error("stdin is not available for this exec session");
  }
  await session.stdin.write(data);
  if (close) {
    await session.stdin.close();
    session.stdin = null;
  }
}

export async function signalExecSession(id: string, signal: number): Promise<void> {
  const session = requireExecSession(id);
  touch(session);
  await session.handle.signal(signal);
}

export async function killExecSession(id: string): Promise<void> {
  const session = requireExecSession(id);
  touch(session);
  await session.handle.kill();
}

export async function closeExecSession(id: string): Promise<void> {
  const session = requireExecSession(id);
  sessions.delete(id);
  if (session.stdin) await session.stdin.close();
  await session.handle[Symbol.asyncDispose]();
}

function requireExecSession(id: string): ExecSession {
  cleanupExecSessions();
  const session = sessions.get(id);
  if (!session) throw new Error(`exec session not found: ${id}`);
  return session;
}

async function readEvents(session: ExecSession): Promise<void> {
  try {
    for (;;) {
      const event = await session.handle.recv();
      if (event === null) {
        session.done = true;
        session.updatedAt = new Date();
        await stopSandboxIfNeeded(session);
        return;
      }

      if (event.kind === "exited") {
        session.exitStatus = {
          code: event.code,
          success: event.code === 0,
        };
      }

      session.events.push({
        index: session.events.length,
        event: serializeExecEvent(event),
      });
      session.updatedAt = new Date();
    }
  } catch (error) {
    session.error = error instanceof Error ? error.message : String(error);
    session.done = true;
    session.updatedAt = new Date();
    await stopSandboxIfNeeded(session);
  }
}

function serializeExecEvent(event: ExecEvent): Record<string, unknown> {
  switch (event.kind) {
    case "stdout":
    case "stderr":
      return {
        kind: event.kind,
        data: Buffer.from(event.data).toString("utf8"),
      };
    default:
      return event;
  }
}

function touch(session: ExecSession): void {
  session.updatedAt = new Date();
}

function cleanupExecSessions(): void {
  const ttl = getServerConfig().sessionTtlMs;
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt.getTime() > ttl) {
      sessions.delete(id);
      if (session.stopSandboxOnExit) {
        void stopSandboxByName(session.stopSandboxOnExit);
      }
      void session.handle[Symbol.asyncDispose]();
    }
  }
}

async function stopSandboxIfNeeded(session: ExecSession): Promise<void> {
  if (!session.stopSandboxOnExit) return;
  const name = session.stopSandboxOnExit;
  session.stopSandboxOnExit = null;
  await stopSandboxByName(name);
}

async function stopSandboxByName(name: string): Promise<void> {
  try {
    const handle = await Sandbox.get(name);
    if (handle.status === "running") await handle.stop();
  } catch {
    // Best-effort cleanup for sandboxes started only to host an exec session.
  }
}
