/**
 * What the viewer and the background script say to each other.
 *
 * The page and the viewer have their own table in `bridge.ts`. This is the
 * other edge: messages that keep the patch cache in the background, and,
 * on Firefox, the page asking where github.com redirected a download. Both ends import these types, so
 * neither can send a shape the other does not read.
 */

/** The message channel for the patch cache */
export const CACHE_CHANNEL = 'diffshub-cache';

/** Which shape a cache entry is written in. Bumping it orphans the old ones */
export const CACHE_VERSION = 1;

/** Every cache key starts with this, so the background never touches another key */
export const CACHE_PREFIX = `diffshub.cache.v${CACHE_VERSION}.`;

/**
 * The four things the viewer asks of the cache. A stored value is the answer,
 * gzipped and then base64'd so it survives being stored as json
 */
export type CacheAsk =
  | { channel: typeof CACHE_CHANNEL; op: 'get'; key: string }
  | { channel: typeof CACHE_CHANNEL; op: 'set'; key: string; value: string }
  | { channel: typeof CACHE_CHANNEL; op: 'usage' }
  | { channel: typeof CACHE_CHANNEL; op: 'clear' };

/** The message channel for the page to ask where github.com redirected a download */
export const ADDRESS_CHANNEL = 'diffshub-signed-address';

/** What the page sends: the github.com address it asked for, on its own session */
export type AddressAsk = { channel: typeof ADDRESS_CHANNEL; url: string };
