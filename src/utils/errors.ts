import { errorResult, type ToolResult } from "./response.js";
import { PolicyError, formatPolicyError } from "./policy.js";

export function formatError(error: unknown): ToolResult {
  if (error instanceof PolicyError) {
    return formatPolicyError(error);
  }

  return errorResult(error);
}
