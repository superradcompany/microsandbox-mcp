import path from "node:path";

export interface ServerConfig {
  hostPathPolicy: "allowlist" | "unrestricted";
  hostPaths: string[];
  dangerousEnabled: boolean;
  maxOutputBytes: number;
  defaultTimeoutMs: number;
  sessionTtlMs: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SESSION_TTL_MS = 900_000;

let cachedConfig: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;

  const hostPathPolicy = parseHostPathPolicy(process.env.MICROSANDBOX_MCP_HOST_PATH_POLICY);
  const hostPaths = parseHostPaths(process.env.MICROSANDBOX_MCP_HOST_PATHS);

  cachedConfig = {
    hostPathPolicy,
    hostPaths,
    dangerousEnabled: process.env.MICROSANDBOX_MCP_ENABLE_DANGEROUS === "1",
    maxOutputBytes: parsePositiveInt(
      process.env.MICROSANDBOX_MCP_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
    ),
    defaultTimeoutMs: parsePositiveInt(
      process.env.MICROSANDBOX_MCP_DEFAULT_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    sessionTtlMs: parsePositiveInt(
      process.env.MICROSANDBOX_MCP_SESSION_TTL_MS,
      DEFAULT_SESSION_TTL_MS,
    ),
  };

  return cachedConfig;
}

export function resetServerConfigForTests(): void {
  cachedConfig = undefined;
}

function parseHostPathPolicy(value: string | undefined): "allowlist" | "unrestricted" {
  if (value === "unrestricted") return "unrestricted";
  return "allowlist";
}

function parseHostPaths(value: string | undefined): string[] {
  const rawPaths = value && value.trim().length > 0 ? value.split(":") : [process.cwd()];
  return rawPaths
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
