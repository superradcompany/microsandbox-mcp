import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Snapshot } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { assertHostPathAllowed } from "../utils/policy.js";
import { fail, ok } from "../utils/response.js";
import { snapshotData, snapshotHandleData } from "../utils/serialization.js";

export function registerSnapshotTools(server: McpServer): void {
  server.registerTool(
    "snapshot_create",
    {
      title: "Create Snapshot",
      description: "Create a snapshot from a stopped sandbox.",
      inputSchema: z.object({
        sourceSandbox: z.string().describe("Stopped source sandbox name"),
        name: z.string().optional().describe("Snapshot name under the default snapshot directory"),
        path: z.string().optional().describe("Explicit host path for the snapshot artifact"),
        labels: z.record(z.string(), z.string()).optional().describe("Snapshot labels"),
        force: z.boolean().optional().describe("Overwrite an existing destination"),
        recordIntegrity: z.boolean().optional().describe("Record upper-layer integrity metadata"),
        confirm: z.boolean().optional().describe("Required when force is true"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sourceSandbox, name, path: snapshotPath, labels, force, recordIntegrity, confirm }) => {
      try {
        if (force && !confirm) {
          return fail("dangerous_operation_disabled", "snapshot_create with force requires confirm: true");
        }
        if ((name ? 1 : 0) + (snapshotPath ? 1 : 0) !== 1) {
          throw new Error("snapshot_create requires exactly one of name or path");
        }

        let builder = Snapshot.builder(sourceSandbox);
        if (name) builder = builder.name(name);
        if (snapshotPath) builder = builder.path(assertHostPathAllowed(snapshotPath));
        if (force) builder = builder.force();
        if (recordIntegrity) builder = builder.recordIntegrity();
        for (const [key, value] of Object.entries(labels ?? {})) {
          builder = builder.label(key, value);
        }

        return ok(snapshotData(await builder.create()));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_list",
    {
      title: "List Snapshots",
      description: "List indexed snapshots.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        return ok((await Snapshot.list()).map(snapshotHandleData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_inspect",
    {
      title: "Inspect Snapshot",
      description: "Inspect snapshot metadata by name, digest, or path.",
      inputSchema: z.object({
        pathOrName: z.string().describe("Snapshot name, digest, or host path"),
        verify: z.boolean().optional().describe("Also verify recorded integrity"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ pathOrName, verify }) => {
      try {
        const snapshot = await openSnapshot(pathOrName);
        return ok({
          ...snapshotData(snapshot),
          verify: verify ? await snapshot.verify() : undefined,
        });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_verify",
    {
      title: "Verify Snapshot",
      description: "Verify recorded snapshot content integrity.",
      inputSchema: z.object({
        pathOrName: z.string().describe("Snapshot name, digest, or host path"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ pathOrName }) => {
      try {
        const snapshot = await openSnapshot(pathOrName);
        return ok(await snapshot.verify());
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_remove",
    {
      title: "Remove Snapshots",
      description: "Remove one or more snapshots by name, digest, or path.",
      inputSchema: z.object({
        pathOrName: z.string().optional().describe("Snapshot name, digest, or host path"),
        pathOrNames: z.array(z.string()).optional().describe("Snapshot names, digests, or host paths"),
        force: z.boolean().optional().describe("Remove snapshots that have indexed children"),
        confirm: z.boolean().optional().describe("Required when force is true"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ pathOrName, pathOrNames, force, confirm }) => {
      try {
        if (force && !confirm) {
          return fail("dangerous_operation_disabled", "snapshot_remove with force requires confirm: true");
        }
        const targets = [...(pathOrName ? [pathOrName] : []), ...(pathOrNames ?? [])];
        if (targets.length === 0) throw new Error("snapshot_remove requires pathOrName or pathOrNames");
        const results = [];
        for (const target of targets) {
          const resolved = resolveSnapshotArg(target);
          await Snapshot.remove(resolved, { force });
          results.push({ pathOrName: target, removed: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_reindex",
    {
      title: "Reindex Snapshots",
      description: "Rebuild the local snapshot index from the default directory or an allowlisted host directory.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Snapshot directory to scan"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ dir }) => {
      try {
        const indexed = await Snapshot.reindex(dir ? assertHostPathAllowed(dir) : undefined);
        return ok({ dir: dir ?? null, indexed });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_export",
    {
      title: "Export Snapshot",
      description: "Export a snapshot to a tar.zst or plain tar archive.",
      inputSchema: z.object({
        pathOrName: z.string().describe("Snapshot name, digest, or host path"),
        out: z.string().describe("Allowlisted host archive output path"),
        withParents: z.boolean().optional(),
        withImage: z.boolean().optional(),
        plainTar: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ pathOrName, out, withParents, withImage, plainTar }) => {
      try {
        const outputPath = assertHostPathAllowed(out);
        await Snapshot.export(resolveSnapshotArg(pathOrName), outputPath, {
          withParents,
          withImage,
          plainTar,
        });
        return ok({ pathOrName, out: outputPath, exported: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_import",
    {
      title: "Import Snapshot",
      description: "Import a snapshot archive into the default or specified snapshots directory.",
      inputSchema: z.object({
        archive: z.string().describe("Allowlisted host archive path"),
        dest: z.string().optional().describe("Allowlisted destination directory"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ archive, dest }) => {
      try {
        const handle = await Snapshot.import(
          assertHostPathAllowed(archive),
          dest ? assertHostPathAllowed(dest) : undefined,
        );
        return ok(snapshotHandleData(handle));
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

function resolveSnapshotArg(pathOrName: string): string {
  return looksLikePath(pathOrName) ? assertHostPathAllowed(pathOrName) : pathOrName;
}

async function openSnapshot(pathOrName: string): Promise<Snapshot> {
  if (looksLikePath(pathOrName)) return Snapshot.open(assertHostPathAllowed(pathOrName));
  try {
    return await (await Snapshot.get(pathOrName)).open();
  } catch {
    return Snapshot.open(pathOrName);
  }
}

function looksLikePath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith("~");
}
