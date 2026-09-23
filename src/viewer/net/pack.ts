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
 * a specification's. Past it, packing fails and the cache quietly keeps
 * nothing. Eight thousand leaves more than an order of magnitude of room, and
 * the loop around it costs nothing worth measuring.
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
 *
 * It takes the chunks as they arrived rather than a string. A `Blob` joins them
 * itself, so nothing here builds a second copy of the patch, and the bytes never
 * become a javascript string -- which for anything outside latin-1 would be two
 * bytes a character for no reason.
 */
export async function pack(chunks: readonly Uint8Array[]): Promise<string | undefined> {
  try {
    const gzip = new CompressionStream('gzip');
    const parts = chunks as unknown as BlobPart[];
    const bytes = await new Response(new Blob(parts).stream().pipeThrough(gzip)).bytes();
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

/** Base64, `BASE64_CHUNK` bytes at a time */
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
