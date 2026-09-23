/** An error as a sentence, whatever was thrown */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
