/**
 * Squeezing an answer down small enough to keep, and letting it back out.
 *
 * Its own module, and one that imports nothing: what it does is arithmetic on
 * bytes, it has no business knowing about fetching or storage, and the tests
 * run it in plain node where an import alias would not resolve.
 *
 * `docs/caching.md` says why any of it is compressed at all.
 */

/**
 * How many bytes are turned into characters at a time.
 *
 * `String.fromCharCode` takes them as arguments, and a spread of more than
 * roughly 123,000 overflows the stack -- measured, and the number is V8's, not
 * a specification's. Eight thousand leaves more than an order of magnitude of
 * room, and the loop around it costs nothing worth measuring.
 *
 * This is about base64 alone. How much of a stored answer is handed back at a
 * time is decided by `Blob.stream()` and the decompressor, not here.
 */
const BASE64_CHUNK = 8192;

/**
 * Gzip, then base64.
 *
 * Gzip because a patch is repetitive text: a real one measures 7.5 times
 * smaller, which is the difference between keeping the large pull requests and
 * refusing them. Base64 because what is stored has to survive being held as
 * json, and bytes do not -- a `Uint8Array` comes back as `{"0":31,"1":139}`.
 *
 * The third of a size base64 costs back is worth paying for the seven it saves.
 */
export async function pack(text: string, maxRawChars: number): Promise<string | undefined> {
  if (text.length > maxRawChars) return undefined;
  try {
    const gzip = new CompressionStream('gzip');
    const bytes = await new Response(new Blob([text]).stream().pipeThrough(gzip)).bytes();
    return toBase64(bytes);
  } catch {
    // No compression to be had here, so there is nothing worth storing either
    return undefined;
  }
}

/**
 * Base64, then gunzip, arriving as a stream the parser pulls on.
 *
 * Returns nothing rather than throwing when what was stored cannot be read, so
 * an unreadable entry costs a download the way a missing one does.
 */
export function unpack(packed: string): ReadableStream<Uint8Array> | undefined {
  try {
    const bytes = fromBase64(packed);
    const source = new Blob([bytes as BlobPart]).stream();
    return source.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>;
  } catch {
    return undefined;
  }
}

/**
 * Base64, a chunk at a time.
 *
 * The chunk is what matters here: spreading a whole patch into
 * `String.fromCharCode` throws `RangeError`, and it throws silently as far as
 * the reader is concerned, because the caller treats a failure to pack as
 * nothing worth keeping. A cache that quietly stops above a size is worse than
 * no cache, so the size is picked well below where it breaks.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}

function fromBase64(packed: string): Uint8Array {
  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}
