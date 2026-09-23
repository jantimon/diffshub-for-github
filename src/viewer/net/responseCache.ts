import { CACHE_CHANNEL, CACHE_PREFIX, type CacheAsk } from '@/shared/runtime';

/**
 * A short-lived copy of what github.com answered, keyed by the head commit.
 *
 * Reopening a pull request already read costs the whole patch again -- 740 KB
 * on a forty-file review, from the one host that refuses under load. This keeps
 * the answer in `storage.session`, which lives in memory for as long as the
 * browser is open and is gone when it closes. Never `storage.local` and never
 * the Cache API: the diff of a private repository has no business on disk.
 *
 * Every entry is keyed by the commit the page was showing, so a page on a newer
 * commit asks a different key and downloads. Where the commit is unknown there
 * is no key and nothing is read or written.
 *
 * All of it is an optimisation, so every path swallows its own failures: each
 * costs a download, never a render. `docs/caching.md` has the rest.
 */

/**
 * How much may be kept, counted in stored characters.
 *
 * `storage.session` holds 10,485,760 bytes and refuses a value past that. The
 * budget sits under it, and when a write would cross it the whole cache goes
 * rather than the oldest entry: at around 135 KB a patch that is dozens of pull
 * requests before it happens, and the cost is one download of whichever comes
 * back.
 *
 * Usage is checked before writing rather than left to the quota, so the bound
 * holds on a browser that does not enforce one.
 */
const BUDGET_CHARS = 8_000_000;

/** More downloaded bytes than this are not worth compressing to find out */
export const MAX_RAW_BYTES = 48_000_000;

/**
 * Always through the background, in both browsers. Firefox withholds
 * `browser.storage` from a viewer framed by github.com, and Chrome's viewer has
 * it, but one route is one thing to test: the Chrome suite then runs the same
 * path Firefox does. What crosses is a string, so nothing depends on how a
 * browser serialises a message.
 */
async function askBackground(message: CacheAsk): Promise<unknown> {
  return await browser.runtime.sendMessage(message);
}

async function store(key: string, packed: string): Promise<void> {
  if ((await askBackground({ channel: CACHE_CHANNEL, op: 'set', key, value: packed })) !== true) {
    throw new Error('the background did not store it');
  }
}

async function clear(): Promise<void> {
  await askBackground({ channel: CACHE_CHANNEL, op: 'clear' });
}

function keyOf(sha: string, url: string): string {
  return `${CACHE_PREFIX}${sha}.${url}`;
}

/** The compressed answer, or nothing */
export async function readCached(sha: string, url: string): Promise<string | undefined> {
  try {
    const stored = await askBackground({ channel: CACHE_CHANNEL, op: 'get', key: keyOf(sha, url) });
    return typeof stored === 'string' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Says whether it stored, so the log does not report a copy that was never made */
export async function writeCached(sha: string, url: string, packed: string): Promise<boolean> {
  if (packed.length > BUDGET_CHARS) return false;

  const key = keyOf(sha, url);
  try {
    const usage = Number(await askBackground({ channel: CACHE_CHANNEL, op: 'usage' }));
    if (usage + packed.length > BUDGET_CHARS) await clear();
    await store(key, packed);
    return true;
  } catch {
    return false;
  }
}
