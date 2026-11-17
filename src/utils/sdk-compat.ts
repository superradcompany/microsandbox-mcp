import type { Sandbox } from "microsandbox";

export type SandboxHandle = Awaited<ReturnType<typeof Sandbox.get>>;

/** Read an SDK field that became an asynchronous observation in the resource API. */
export async function observation<T>(owner: object, key: string): Promise<T> {
  const value: unknown = Reflect.get(owner, key);
  return (typeof value === "function" ? await value.call(owner) : value) as T;
}

export async function sandboxStatus(handle: SandboxHandle): Promise<string> {
  return observation<string>(handle, "status");
}

export async function connectSandbox(handle: SandboxHandle): Promise<Sandbox> {
  const connect: unknown = Reflect.get(handle, "connect");
  if (typeof connect === "function") return await connect.call(handle);
  if (await sandboxStatus(handle) !== "running") {
    throw new Error(`sandbox ${handle.name} is not running`);
  }
  return handle as unknown as Sandbox;
}

/** Start the captured resource without looking its name up again. */
export async function startSandbox(handle: SandboxHandle): Promise<Sandbox> {
  const start: unknown = Reflect.get(handle, "startDetached");
  if (typeof start === "function") return await start.call(handle);
  const sandbox = handle as unknown as Sandbox;
  const ensureRunning: unknown = Reflect.get(sandbox, "ensureRunning");
  if (typeof ensureRunning !== "function") {
    throw new Error("The installed microsandbox SDK cannot start a captured sandbox");
  }
  await ensureRunning.call(sandbox);
  await sandbox.detach();
  return sandbox;
}
