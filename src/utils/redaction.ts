const SECRET_KEY_PATTERN = /(password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redact(nested);
    }
    return result;
  }

  return value;
}
