/**
 * `githubFetch` with a copy kept, so the second read of a pull request is free.
 *
 * A wrapper rather than a change to `githubFetch` itself, for three reasons.
 * The background script imports that module, and nothing there should ever
 * cache. A fetch helper whose whole subject is the Chrome and Firefox cookie
 * jars has no business knowing about commits.
 *
 * And caching has to be asked for, because an opt-out is the wrong default for
 * something that stores the contents of private repositories.
 *
 * `docs/caching.md` draws the path a request takes through here.
 */

import { githubFetch } from '@/viewer/files/githubFetch';
import { pack, unpack } from '@/viewer/files/pack';
import { debugLog } from '@/viewer/debug';
import { describeStorage, MAX_RAW_BYTES, readCached, writeCached } from '@/viewer/files/responseCache';

/** Marks a response that never touched the network, for anyone reading one */
const CACHE_HEADER = 'x-diffshub-cache';

let said = false;

/** Says where an answer came from, which is the first thing worth knowing when the cache misbehaves */
const note = (message: string): void => debugLog(message);

function named(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).slice(0, 60);
}

function kb(chars: number): string {
  return `${Math.round(chars / 1024).toLocaleString()} KB`;
}

export interface CachedFetchOptions {
  /**
   * The commit the page is showing. Without one the cache is off for this call:
   * a key that is not the commit is a key that can hand back the wrong diff
   */
  sha: string | undefined;
  /** Gives up the download, and the copy being taken of it, together */
  signal?: AbortSignal;
}

export async function cachedGithubFetch(url: string, { sha, signal }: CachedFetchOptions): Promise<Response> {
  if (sha == null) return githubFetch(url, signal);

  // Where things are kept is a fact about the session, not about this request,
  // and expanding a file asks for one of these each time
  if (!said) {
    said = true;
    note(`keeping what github.com answers in ${describeStorage()}`);
  }

  const hit = await readCached(sha, url);
  const unpacked = hit == null ? undefined : unpack(hit);
  // A hit that will not unpack is worse than a miss if it goes unsaid: the
  // download happens anyway and nothing explains why
  if (hit != null && unpacked == null) note(`${named(url)} was cached but would not unpack`);
  if (unpacked != null) {
    note(`${named(url)} reused from the cache, ${kb(hit?.length ?? 0)} stored`);
    return new Response(unpacked, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', [CACHE_HEADER]: 'hit' },
    });
  }

  const response = await githubFetch(url, signal);
  // A 404 from a lapsed session, or a 503 from a host under load, has to be
  // asked again next time rather than remembered for the rest of the session
  if (!response.ok || response.body == null) {
    note(`${named(url)} refused by github.com, ${response.status} ${response.statusText}`);
    return response;
  }
  note(`${named(url)} fetched from github.com`);

  return new Response(response.body.pipeThrough(capture(sha, url, signal)), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Passes the body through, keeping a copy of what went past.
 *
 * A pass-through and not a split. A split stream pulls its source whenever
 * either half pulls, so the half being kept -- which reads as fast as it can --
 * took the network at full speed while the parser worked to its own budget.
 * Everything the parser had not reached piled up in memory.
 *
 * Here the parser is the only thing pulling, which is the backpressure a plain
 * `fetch` has.
 *
 * It also decides what "finished" means, and decides it better.
 *
 * `flush` runs only when the source ends of its own accord. A body that stops
 * short errors the stream, a reader giving up cancels it, and neither runs
 * `flush` -- so neither can leave half a patch to be served as the whole. That
 * is the signal the parser trusts to call the diff complete, so the two can no
 * longer disagree.
 */
function capture(
  sha: string,
  url: string,
  signal: AbortSignal | undefined,
): TransformStream<Uint8Array, Uint8Array> {
  let chunks: Uint8Array[] | undefined = [];
  let bytes = 0;

  return new TransformStream({
    transform(chunk, controller) {
      // Downstream first: the reader waits on nothing this does
      controller.enqueue(chunk);
      if (chunks == null) return;

      bytes += chunk.byteLength;
      if (bytes > MAX_RAW_BYTES) {
        // Beyond what could be kept anyway, so stop holding it
        chunks = undefined;
        return;
      }
      chunks.push(chunk);
    },

    flush() {
      const kept = chunks;
      chunks = undefined;
      if (kept == null || signal?.aborted === true) return;
      // Nothing waits for this. The patch is downloaded and parsed, and
      // compressing it is work for a moment nobody is waiting through
      whenIdle(() => void store(kept, sha, url));
    },
  });
}

async function store(chunks: Uint8Array[], sha: string, url: string): Promise<void> {
  let raw = 0;
  for (const chunk of chunks) raw += chunk.byteLength;

  const packed = await pack(chunks);
  if (packed == null) {
    note(`${named(url)} not kept, ${kb(raw)} would not compress or is too large`);
    return;
  }

  const kept = await writeCached(sha, url, packed);
  note(
    kept
      ? `${named(url)} kept, ${kb(raw)} of diff as ${kb(packed.length)}`
      : `${named(url)} not kept, storage refused ${kb(packed.length)}`,
  );
}

/**
 * Runs the work when the browser has nothing better to do.
 *
 * Compressing a large patch is not free, and the moment it finishes downloading
 * is the moment the diff is still drawing. Firefox and Chrome both have
 * `requestIdleCallback`, and a timeout is the fallback, no worse than what this
 * replaced.
 */
function whenIdle(work: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(work);
  else setTimeout(work, 0);
}
