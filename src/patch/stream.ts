const FILE_BOUNDARY = '\ndiff --git ';

/**
 * Splits a git patch into whole files as the bytes arrive, so the first file can
 * be parsed and rendered long before the last one has downloaded.
 *
 * A file is emitted only once the *next* header is seen, which is what makes
 * each emitted chunk complete.
 */
export async function streamPatchFiles(
  body: ReadableStream<Uint8Array>,
  onFile: (fileText: string) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  // TextDecoderStream declares a writable of BufferSource, wider than the
  // Uint8Array chunks pipeThrough insists on
  const decoder = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>;
  const reader = body.pipeThrough(decoder).getReader();
  let buffer = '';
  let searchFrom = 0;

  try {
    for (;;) {
      if (signal?.aborted === true) return;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      for (;;) {
        const boundary = buffer.indexOf(FILE_BOUNDARY, searchFrom);
        if (boundary === -1) {
          // A boundary can straddle two chunks, so keep the tail searchable
          searchFrom = Math.max(0, buffer.length - FILE_BOUNDARY.length);
          break;
        }
        const fileText = buffer.slice(0, boundary + 1);
        buffer = buffer.slice(boundary + 1);
        searchFrom = 0;
        if (fileText.trim() !== '') await onFile(fileText);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim() !== '') await onFile(buffer);
}
