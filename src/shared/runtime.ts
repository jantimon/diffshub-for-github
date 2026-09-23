/**
 * What the viewer and the background script say to each other.
 *
 * The page and the viewer have their own table in `bridge.ts`. This is the
 * other edge: a port that fetches github.com for the viewer on Firefox
 * (`docs/firefox.md`), and messages that keep the patch cache in the
 * background (`docs/caching.md`). Both ends import these types, so neither can
 * send a shape the other does not read.
 */

/** The port the viewer opens to have the background fetch for it */
export const FETCH_PORT = 'diffshub-github-fetch';

/** What the viewer sends on the port: one request per connection */
export interface FetchRequest {
  url: string;
}

/** What comes back: the head first, then the body in chunks, then an end */
export type FetchReply =
  | { type: 'head'; status: number; statusText: string; headers: [string, string][] }
  | { type: 'chunk'; chunk: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; message: string };

/** The message channel for the patch cache */
export const CACHE_CHANNEL = 'diffshub-cache';

/** Which shape a cache entry was written in. Bumping it orphans the old ones */
export const CACHE_VERSION = 1;

/** Every cache key starts with this, so the background never touches another key */
export const CACHE_PREFIX = `diffshub.cache.v${CACHE_VERSION}.`;

/** One stored answer */
export interface CacheBody {
  /** Which shape of this the entry was written in */
  v: number;
  /** The answer, gzipped and then base64'd so it survives being stored as json */
  packed: string;
}

/** The four things the viewer asks of the cache */
export type CacheAsk =
  | { channel: typeof CACHE_CHANNEL; op: 'get'; key: string }
  | { channel: typeof CACHE_CHANNEL; op: 'set'; key: string; value: CacheBody }
  | { channel: typeof CACHE_CHANNEL; op: 'usage' }
  | { channel: typeof CACHE_CHANNEL; op: 'clear' };

/**
 * The hosts the background fetches from for the viewer: GitHub itself and the
 * hosts it sends the patch and raw files from. Anything else is refused, so the
 * reader's session never goes anywhere GitHub does not
 */
export function isGithubUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === 'https:' && (hostname === 'github.com' || hostname.endsWith('.githubusercontent.com'))
    );
  } catch {
    return false;
  }
}
