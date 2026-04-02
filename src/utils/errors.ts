export function formatError(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
