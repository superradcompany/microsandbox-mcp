import type { ExecOutput } from "microsandbox";

import { compactTruncations, limitText } from "./output.js";

export function formatExecOutput(output: ExecOutput): {
  data: {
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
  };
  truncated?: ReturnType<typeof compactTruncations>;
};
export function formatExecOutput(output: ExecOutput, maxBytes: number | undefined): {
  data: {
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
  };
  truncated?: ReturnType<typeof compactTruncations>;
};
export function formatExecOutput(output: ExecOutput, maxBytes?: number): {
  data: {
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
  };
  truncated?: ReturnType<typeof compactTruncations>;
} {
  const stdout = limitText(output.stdout(), "stdout", maxBytes);
  const stderr = limitText(output.stderr(), "stderr", maxBytes);

  return {
    data: {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode: output.code,
      success: output.success,
    },
    truncated: compactTruncations([stdout.truncated, stderr.truncated]),
  };
}
