import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Image, isInstalled, Sandbox, Snapshot, Volume } from "microsandbox";

import { getServerConfig } from "./config.js";
import { sandboxCreateSchema } from "./tools/sandbox.js";
import {
  imageHandleData,
  sandboxSummaryData,
  snapshotHandleData,
  volumeHandleData,
} from "./utils/serialization.js";

export function registerResources(server: McpServer): void {
  server.registerResource(
    "runtime",
    "microsandbox://runtime",
    {
      title: "microsandbox runtime",
      description: "Runtime installation and MCP server configuration.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, {
      installed: isInstalled(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      msbPath: process.env.MSB_PATH ?? null,
      libkrunfwPath: process.env.MSB_LIBKRUNFW_PATH ?? null,
      policy: policyData(),
    }),
  );

  server.registerResource(
    "sandboxes",
    "microsandbox://sandboxes",
    {
      title: "microsandbox sandboxes",
      description: "Current sandbox inventory.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, (await Sandbox.list()).map(sandboxSummaryData)),
  );

  server.registerResource(
    "volumes",
    "microsandbox://volumes",
    {
      title: "microsandbox volumes",
      description: "Current volume inventory.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, (await Volume.list()).map(volumeHandleData)),
  );

  server.registerResource(
    "images",
    "microsandbox://images",
    {
      title: "microsandbox images",
      description: "Current cached image inventory.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, (await Image.list()).map(imageHandleData)),
  );

  server.registerResource(
    "snapshots",
    "microsandbox://snapshots",
    {
      title: "microsandbox snapshots",
      description: "Current indexed snapshot inventory.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, (await Snapshot.list()).map(snapshotHandleData)),
  );

  server.registerResource(
    "sandbox-create-schema",
    "microsandbox://schemas/sandbox-create",
    {
      title: "sandbox create schema",
      description: "JSON Schema for sandbox_create and sandbox_run creation fields.",
      mimeType: "application/schema+json",
    },
    async (uri) => jsonResource(uri, z.toJSONSchema(sandboxCreateSchema)),
  );

  server.registerResource(
    "policy",
    "microsandbox://policy",
    {
      title: "microsandbox MCP policy",
      description: "Effective host path and dangerous operation policy.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, policyData()),
  );
}

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function policyData(): Record<string, unknown> {
  const config = getServerConfig();
  return {
    hostPathPolicy: config.hostPathPolicy,
    hostPaths: config.hostPaths,
    dangerousEnabled: config.dangerousEnabled,
    maxOutputBytes: config.maxOutputBytes,
    defaultTimeoutMs: config.defaultTimeoutMs,
    sessionTtlMs: config.sessionTtlMs,
  };
}
