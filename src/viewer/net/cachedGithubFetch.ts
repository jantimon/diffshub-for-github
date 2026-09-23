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

import { githubFetch } from '@/viewer/net/githubFetch';
import { pack, unpack } from '@/viewer/net/pack';
import { debugLog } from '@/viewer/debug';
import { describeStorage, MAX_RAW_BYTES, readCached, writeCached } from '@/viewer/net/responseCache';

/**
 * Answers that mean "not now" rather than "no": rate limited, or a host under
 * load. `patch-diff.githubusercontent.com` gives a 503 often enough to matter
 */
const TRY_AGAIN = new Set([429, 502, 503, 504]);

/** The waits before each further try. Two more tries, then the refusal is shown */
const RETRY_DELAYS_MS = [1000, 3000];

/** The longest a `Retry-After` is followed, so a reader is never left waiting a minute */
const MAX_RETRY_AFTER_MS = 10_000;

/** Marks a response that never touched the network, for anyone reading one */
const CACHE_HEADER = 'x-diffshub-cache';

let said = false;

/**
 * Says where an answer came from and what was kept of it, which is the first
 * thing worth knowing when the cache misbehaves. One line per outcome, each
 * naming the file and the commit it belongs to
 */
const note = (message: string): void => debugLog(`cache: ${message}`);

function commit(sha: string): string {
  return `commit ${sha.slice(0, 7)}`;
}

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
  if (sha == null) {
    note(
      `${named(url)} downloaded from github.com and not saved: the page did not say which commit it shows`,
    );
    return fetchPatiently(url, signal);
  }

  // Where copies go is a fact about the session, not about this request, and
  // expanding a file asks for one of these each time
  if (!said) {
    said = true;
    note(describeStorage());
  }

  const hit = await readCached(sha, url);
  const unpacked = hit == null ? undefined : unpack(hit);
  // A hit that will not unpack is worse than a miss if it goes unsaid: the
  // download happens anyway and nothing explains why
  if (hit != null && unpacked == null) {
    note(`${named(url)} was saved but could not be read back, so it is downloaded again`);
  }
  if (unpacked != null) {
    note(`${named(url)} loaded from the saved copy (${commit(sha)}), nothing downloaded`);
    return new Response(unpacked, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', [CACHE_HEADER]: 'hit' },
    });
  }

  const response = await fetchPatiently(url, signal);
  // A 404 from a lapsed session, or a 503 from a host under load, has to be
  // asked again next time rather than remembered for the rest of the session
  if (!response.ok || response.body == null) {
    note(`${named(url)} refused by github.com: ${response.status} ${response.statusText}, nothing saved`);
    return response;
  }
  note(`${named(url)} not saved yet for ${commit(sha)}, downloading from github.com`);

  return new Response(response.body.pipeThrough(capture(sha, url, signal)), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** `githubFetch`, asked again after a refusal that says to come back later */
async function fetchPatiently(url: string, signal: AbortSignal | undefined): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await githubFetch(url, signal);
    const delay = RETRY_DELAYS_MS[attempt];
    if (!TRY_AGAIN.has(response.status) || delay == null) return response;

    const asked = Number(response.headers.get('retry-after')) * 1000;
    const wait = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_RETRY_AFTER_MS) : delay;
    note(`${named(url)} refused by github.com: ${response.status}, try ${attempt + 2} in ${wait / 1000} s`);
    await response.body?.cancel();
    await pause(wait, signal);
  }
}

/** Waits, or rejects as a fetch does when the signal gives up */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
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
    note(`${named(url)} downloaded (${kb(raw)}) but not saved: it would not compress`);
    return;
  }

  const kept = await writeCached(sha, url, packed);
  note(
    kept
      ? `${named(url)} downloaded (${kb(raw)}) and saved for next time, ${kb(packed.length)} compressed`
      : `${named(url)} downloaded (${kb(raw)}) but not saved: storage refused ${kb(packed.length)}`,
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
