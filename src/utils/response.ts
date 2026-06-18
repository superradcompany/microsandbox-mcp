import { redact } from "./redaction.js";
import type { Truncation } from "./output.js";

export interface ToolOk<T> {
  ok: true;
  data: T;
  warnings?: string[];
  truncated?: Truncation[];
}

export interface ToolError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
}

type TextContent = { type: "text"; text: string };

export type ToolResult = {
  content: TextContent[];
  isError?: true;
};

export function ok<T>(
  data: T,
  options: { warnings?: string[]; truncated?: Truncation[] } = {},
): ToolResult {
  const body: ToolOk<T> = {
    ok: true,
    data,
    ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
    ...(options.truncated && options.truncated.length > 0 ? { truncated: options.truncated } : {}),
  };

  return jsonResult(body);
}

export function fail(
  code: string,
  message: string,
  options: { details?: unknown; retryable?: boolean } = {},
): ToolResult {
  const body: ToolError = {
    ok: false,
    error: {
      code,
      message,
      ...(options.details !== undefined ? { details: redact(options.details) } : {}),
      ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
    },
  };

  return {
    ...jsonResult(body),
    isError: true,
  };
}

export function errorResult(error: unknown, code = "operation_failed"): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return fail(code, message);
}

function jsonResult(body: ToolOk<unknown> | ToolError): ToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(body, null, 2),
    }],
  };
}
