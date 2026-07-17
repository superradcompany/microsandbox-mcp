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
      description: "Create a named snapshot from a stopped sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Snapshot name; always the artifact directory's basename"),
        fromSandbox: z.string().describe("Stopped source sandbox name"),
        destDir: z
          .string()
          .optional()
          .describe("Allowlisted parent directory to create the artifact in, instead of the default snapshots directory"),
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
    async ({ name, fromSandbox, destDir, labels, force, recordIntegrity, confirm }) => {
      try {
        if (force && !confirm) {
          return fail("dangerous_operation_disabled", "snapshot_create with force requires confirm: true");
        }

        let builder = Snapshot.builder(name).fromSandbox(fromSandbox);
        if (destDir) builder = builder.destDir(assertHostPathAllowed(destDir));
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
    "snapshot_save",
    {
      title: "Save Snapshot",
      description: "Save a snapshot to a tar.zst or plain tar archive.",
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
        await Snapshot.save(resolveSnapshotArg(pathOrName), outputPath, {
          withParents,
          withImage,
          plainTar,
        });
        return ok({ pathOrName, out: outputPath, saved: true });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "snapshot_load",
    {
      title: "Load Snapshot",
      description: "Load a snapshot archive into the default or specified snapshots directory.",
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
        const handle = await Snapshot.load(
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
