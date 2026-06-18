import { getServerConfig } from "../config.js";

export interface Truncation {
  field: string;
  returnedBytes: number;
  totalBytes: number;
}

export interface LimitedText {
  text: string;
  truncated?: Truncation;
}

export function limitText(value: string, field: string, maxBytes = getServerConfig().maxOutputBytes): LimitedText {
  const totalBytes = Buffer.byteLength(value, "utf8");
  if (totalBytes <= maxBytes) {
    return { text: value };
  }

  const limited = Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
  return {
    text: limited,
    truncated: {
      field,
      returnedBytes: Buffer.byteLength(limited, "utf8"),
      totalBytes,
    },
  };
}

export function compactTruncations(values: Array<Truncation | undefined>): Truncation[] | undefined {
  const truncations = values.filter((value): value is Truncation => value !== undefined);
  return truncations.length > 0 ? truncations : undefined;
}
