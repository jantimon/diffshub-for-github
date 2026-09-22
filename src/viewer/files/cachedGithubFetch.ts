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
import { readSetting } from '@/viewer/settings';
import { describeStorage, readCached, storageLimits, writeCached } from '@/viewer/files/responseCache';

/** Marks a response that never touched the network, for anyone reading one */
const CACHE_HEADER = 'x-diffshub-cache';

/**
 * Says where an answer came from.
 *
 * Whether a patch was downloaded or reused is otherwise invisible, and it is
 * the first thing worth knowing when the cache misbehaves. But nothing else in
 * the extension writes to a reader's console, so it is on during development
 * and off in a built one until it is asked for:
 *
 *     localStorage.setItem('diffshub-for-github.debug', 'on')
 *
 * in the viewer's own console, which a built extension has no other way to
 * reach.
 */
let talking: boolean | undefined;
let said = false;

function note(message: string): void {
  talking ??= import.meta.env.DEV || readSetting('debug', 'off') === 'on';
  if (!talking) return;
  console.info(`DiffsHub: ${message}`);
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

  const [toReader, toCache] = response.body.tee();
  void absorb(toCache, sha, url, signal);

  return new Response(toReader, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Reads the second half of the split body into a string and stores it.
 *
 * Nothing waits for this: the download it belongs to has already been handed
 * over and is being parsed. A body that did not finish is thrown away rather
 * than stored -- the reader closing the overlay after five of forty files must
 * not leave those five behind to be served as the whole patch.
 *
 * What makes a short read detectable is the encoding. GitHub sends the patch
 * gzipped and names no length, so there is no count to check against. But a
 * gzip stream carries its own checksum and length in its trailer, and a browser
 * errors a truncated one rather than ending it, so reaching the end without
 * throwing is the guarantee. It is the encoding's guarantee rather than ours.
 */
async function absorb(
  stream: ReadableStream<Uint8Array>,
  sha: string,
  url: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value == null) continue;
      text += decoder.decode(value, { stream: true });
      if (text.length > storageLimits().maxRawChars) {
        // Too big to keep. Letting go of this half stops the split holding
        // chunks for it, and the half being read is untouched, because a split
        // cancels its source only once both halves have been given up
        await reader.cancel();
        return;
      }
    }
    text += decoder.decode();

    if (signal?.aborted === true) return;
    const packed = await pack(text, storageLimits().maxRawChars);
    if (packed == null) {
      note(`${named(url)} not kept, ${kb(text.length)} would not compress or is too large`);
      return;
    }
    const kept = await writeCached(sha, url, packed);
    note(
      kept
        ? `${named(url)} kept, ${kb(text.length)} of diff as ${kb(packed.length)}`
        : `${named(url)} not kept, storage refused ${kb(packed.length)}`,
    );
  } catch {
    // A cancelled download, or a body that stopped short. There is nothing
    // whole to store
  } finally {
    reader.releaseLock();
  }
}
