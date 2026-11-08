import * as sdk from "microsandbox";
import type { SaveOpts, SnapshotBuilder, SnapshotHandle } from "microsandbox";

// The builder remains the artifact builder in both SDK generations. Deriving
// the result here avoids mistaking the new group-oriented Snapshot for a file.
export type Snapshot = Awaited<ReturnType<SnapshotBuilder["create"]>>;

export interface SnapshotArtifactApi {
  builder(name?: string): SnapshotBuilder;
  open(reference: string): Promise<Snapshot>;
  get(reference: string): Promise<SnapshotHandle>;
  list(): Promise<SnapshotHandle[]>;
  remove(reference: string, options?: { force?: boolean }): Promise<void>;
  reindex(directory?: string): Promise<number>;
  save(reference: string, output: string, options?: SaveOpts): Promise<void>;
  load(archive: string, destination?: string): Promise<SnapshotHandle>;
}

const methods = ["builder", "open", "get", "list", "remove", "reindex", "save", "load"] as const;

/** Select once before dispatch; never retry a failed mutation on another API. */
export function selectSnapshotApi(exports: Readonly<Record<string, unknown>>): SnapshotArtifactApi {
  // Presence of Checkpoint identifies the renamed artifact API. If an SDK has
  // an incomplete export, fail explicitly instead of treating a group as a file.
  const candidate = exports.Checkpoint ?? exports.Snapshot;
  if ((typeof candidate !== "function" && typeof candidate !== "object") || candidate === null) {
    throw new Error("The installed microsandbox SDK does not expose the snapshot artifact API");
  }
  for (const method of methods) {
    if (typeof Reflect.get(candidate, method) !== "function") {
      throw new Error(`The installed microsandbox SDK lacks snapshot artifact operation: ${method}`);
    }
  }
  // Structural discovery above is deliberately read-only. Preserve the original
  // receiver so SDK static methods and test instrumentation keep their identity.
  return candidate as SnapshotArtifactApi;
}

export const Snapshot: SnapshotArtifactApi = selectSnapshotApi(sdk);
