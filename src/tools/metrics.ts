import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { allSandboxMetrics, Sandbox } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { ok } from "../utils/response.js";
import { metricsData } from "../utils/serialization.js";

export function registerMetricsTools(server: McpServer): void {
  server.registerTool(
    "sandbox_metrics",
    {
      title: "Get Sandbox Metrics",
      description: "Get live resource usage metrics for a running sandbox.",
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
        const sandbox = await handle.connect();
        return ok(metricsData(await sandbox.metrics()));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_metrics_all",
    {
      title: "Get All Sandbox Metrics",
      description: "Get point-in-time metrics for all running sandboxes.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const metrics = await allSandboxMetrics();
        return ok(Object.fromEntries(
          Object.entries(metrics).map(([name, value]) => [name, metricsData(value)]),
        ));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_metrics_stream",
    {
      title: "Sample Sandbox Metrics Stream",
      description: "Collect a bounded number of metrics samples from a running sandbox.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
        intervalMs: z.number().int().positive().optional().describe("Sampling interval in milliseconds"),
        samples: z.number().int().positive().max(100).optional().describe("Number of samples to collect"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, intervalMs, samples }) => {
      const stream = await (async () => {
        const handle = await Sandbox.get(name);
        const sandbox = await handle.connect();
        return sandbox.metricsStream(intervalMs ?? 1000);
      })();

      try {
        const values = [];
        for (let i = 0; i < (samples ?? 1); i += 1) {
          const sample = await stream.recv();
          if (!sample) break;
          values.push(metricsData(sample));
        }
        return ok({ name, intervalMs: intervalMs ?? 1000, samples: values });
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
