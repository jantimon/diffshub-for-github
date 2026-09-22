/**
 * A short-lived copy of what github.com answered, keyed by the head commit.
 *
 * Reopening a pull request already read costs the whole patch again -- 740 KB
 * on a forty-file review, from the one host that refuses under load -- and the
 * reader has waited for it once already. This keeps the answer in
 * `storage.session`, which lives in memory for as long as the browser is open
 * and is gone when it closes.
 *
 * `storage.session` rather than `storage.local`, and never the Cache API: the
 * diff of a private repository has no business on disk. Anyone tempted to move
 * areas to fix a quota should read that sentence again.
 *
 * Every entry is keyed by the commit the page was showing, so a stale diff is
 * not guarded against -- it is unrepresentable. A page on a newer commit asks a
 * different key, misses, and downloads. Where the commit is unknown there is no
 * key at all and nothing is read or written.
 *
 * All of it is an optimisation, so every path swallows its own failures. A
 * blocked storage area, a full quota, a value left by an older version: each
 * costs a download, never a render.
 *
 * `docs/caching.md` has the whole of it: which store is chosen and why, the
 * measured ceilings, and what is deliberately never kept.
 */

const VERSION = 1;
const INDEX_KEY = `diffshub.cache.v${VERSION}.index`;
const BODY_PREFIX = `diffshub.cache.v${VERSION}.body.`;
const LOCK_NAME = `diffshub.cache.v${VERSION}`;

/**
 * What may be kept, measured in the characters actually stored.
 *
 * The ceiling is not ours to choose. `storage.session.QUOTA_BYTES` is
 * 10,485,760 and it is enforced: a 9 MB value stores and reads back, a 10 MB
 * one is refused outright with nothing written. These sit under it with room
 * for the index and for a browser that counts differently.
 *
 * What is stored is compressed, and a real patch compresses 7.5 times over, so
 * the budget holds far more diff than it looks. A 740 KB patch costs about
 * 135 KB of it, and the 20 MB one this viewer was built for costs about
 * 3.6 MB, so it is kept rather than refused.
 *
 * `maxRawBytes` is the guard before any of that: compressing something absurd
 * costs time and memory to reach the same refusal.
 */
export const LIMITS = {
  maxEntries: 24,
  maxEntryChars: 6_000_000,
  maxTotalChars: 8_000_000,
  maxRawBytes: 48_000_000,
} as const;

/**
 * What fits in the page's own session storage instead.
 *
 * Web storage is not part of the quota system the extension area belongs to:
 * it has a hard ceiling of 5 MiB an origin, half what the extension area
 * offers. Compressed that is still some seventeen megabytes of diff, which
 * covers all but the largest reviews.
 */
export const WEB_LIMITS = {
  maxEntries: 12,
  maxEntryChars: 3_000_000,
  maxTotalChars: 4_000_000,
  maxRawBytes: 48_000_000,
} as const;

export interface Limits {
  maxEntries: number;
  maxEntryChars: number;
  maxTotalChars: number;
  /** The most downloaded bytes worth compressing, before anything is spent trying */
  maxRawBytes: number;
}

export interface CacheEntry {
  key: string;
  chars: number;
  usedAt: number;
}

/** What `storage.session` offers, and what the tests hand in instead */
export interface StorageArea {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

interface Index {
  v: number;
  entries: CacheEntry[];
}

interface Body {
  v: number;
  sha: string;
  url: string;
  /** The answer, gzipped and then base64'd so it survives being stored as json */
  packed: string;
}

export function cacheKey(sha: string, url: string): string {
  return `${BODY_PREFIX}${sha}.${url}`;
}

/**
 * What to keep and what to let go when one more answer arrives.
 *
 * Pure, and exported for its own test: this is the whole of the bounds policy,
 * and it is the part worth proving without a browser to hand.
 *
 * Returns nothing when the answer is too big to keep at all, so the caller
 * stores nothing rather than evicting the cache to make room for something that
 * was never going to fit.
 */
export function planEviction(
  entries: readonly CacheEntry[],
  incoming: CacheEntry,
  caps: Limits,
): { keep: CacheEntry[]; evict: string[] } | undefined {
  if (incoming.chars > caps.maxEntryChars) return undefined;

  // Rewriting a key is a move to the end of the queue, not a second entry
  const keep = entries.filter((entry) => entry.key !== incoming.key).toSorted((a, b) => a.usedAt - b.usedAt);

  const evict: string[] = [];
  let total = keep.reduce((sum, entry) => sum + entry.chars, 0) + incoming.chars;

  while (keep.length + 1 > caps.maxEntries || total > caps.maxTotalChars) {
    const oldest = keep.shift();
    // Unreachable while the per-entry cap is under the total, and a silent
    // forever-loop if that ever stops being true
    if (oldest == null) return undefined;
    total -= oldest.chars;
    evict.push(oldest.key);
  }

  return { keep: [...keep, incoming], evict };
}

/**
 * The area this runs against, or nothing where there is none.
 *
 * `browser` is named as a bare identifier because that is what the build
 * rewrites into an import. Reaching for it through `globalThis` instead
 * silently misses on a browser that has no such global and leaves the cache
 * switched off with nothing to say about it.
 *
 * Looked up on each call rather than held, because the tests import this module
 * in plain node where the identifier is free and `typeof` is the only safe way
 * to ask about it.
 */
/**
 * Where the kept answers actually live.
 *
 * The viewer is an extension page, but on Firefox it is one framed by
 * github.com, and there `browser.storage` is not handed to it at all -- the
 * same shape of restriction that keeps its cookie jar partitioned and is why
 * `githubFetch` proxies through the background.
 *
 * So the page's own area is used where it exists, and otherwise the background
 * is asked to hold things on its behalf. The background is a top-level context
 * in both browsers and has the whole api, and what crosses between them is a
 * string, so nothing here depends on how a browser serialises a message.
 */
const CACHE_CHANNEL = 'diffshub-cache';

type CacheAsk =
  | { channel: typeof CACHE_CHANNEL; op: 'get'; keys: string | string[] }
  | { channel: typeof CACHE_CHANNEL; op: 'set'; items: Record<string, unknown> }
  | { channel: typeof CACHE_CHANNEL; op: 'remove'; keys: string | string[] };

function pageArea(): StorageArea | undefined {
  try {
    if (typeof browser === 'undefined') return undefined;
    return browser.storage?.session as StorageArea | undefined;
  } catch {
    return undefined;
  }
}

function backgroundArea(): StorageArea | undefined {
  try {
    if (typeof browser === 'undefined' || browser.runtime?.sendMessage == null) return undefined;
    const ask = async (message: CacheAsk): Promise<unknown> => await browser.runtime.sendMessage(message);
    return {
      get: async (keys) =>
        ((await ask({ channel: CACHE_CHANNEL, op: 'get', keys })) ?? {}) as Record<string, unknown>,
      set: async (items) => {
        const reply = await ask({ channel: CACHE_CHANNEL, op: 'set', items });
        // The quota is the background's to hit, so its refusal has to come back
        // as one here rather than as a silent success
        if (reply !== true) throw new Error('the background did not store it');
      },
      remove: async (keys) => {
        await ask({ channel: CACHE_CHANNEL, op: 'remove', keys });
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Serves {@link readCached} and {@link writeCached} for a viewer that has no
 * storage api of its own. Called from the background entrypoint.
 */
export function serveResponseCache(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, reply: (answer: unknown) => void) => {
      const ask = message as CacheAsk | null;
      if (ask?.channel !== CACHE_CHANNEL) return undefined;

      const session = browser.storage.session;
      const run = async (): Promise<unknown> => {
        if (ask.op === 'get') return await session.get(ask.keys);
        if (ask.op === 'set') {
          await session.set(ask.items);
          return true;
        }
        await session.remove(ask.keys);
        return true;
      };

      // Answering later rather than returning a promise: only one of the two
      // browsers waits for a promise here, both wait for this
      void run().then(reply, () => reply(undefined));
      return true;
    },
  );
}

/**
 * The page's own session storage, as a last resort.
 *
 * Smaller than the extension's area, scoped to this one tab rather than shared,
 * and unlike the extension's area it is written out for session restore rather
 * than held only in memory. So it is reached for only when neither of the
 * others answers, which on a viewer framed by github.com is the case whenever
 * the storage api is withheld from the page and the background cannot be asked.
 */
function webArea(): StorageArea | undefined {
  try {
    if (typeof sessionStorage === 'undefined') return undefined;
    // A partitioned or blocked window throws on the first touch rather than
    // when it is written to, so it is worth finding out here
    sessionStorage.getItem(INDEX_KEY);
    return {
      get: (keys) => {
        const out: Record<string, unknown> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          const raw = sessionStorage.getItem(key);
          if (raw != null) out[key] = JSON.parse(raw) as unknown;
        }
        return Promise.resolve(out);
      },
      set: (items) => {
        // One at a time, so a full quota throws on the value that did not fit
        // and the caller can put its ledger straight
        for (const [key, value] of Object.entries(items)) {
          sessionStorage.setItem(key, JSON.stringify(value));
        }
        return Promise.resolve();
      },
      remove: (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) sessionStorage.removeItem(key);
        return Promise.resolve();
      },
    };
  } catch {
    return undefined;
  }
}

interface Tier {
  name: 'this page' | 'the background' | "this tab's own session storage";
  area: StorageArea;
  limits: Limits;
}

let tier: Tier | undefined;
let looked = false;

function chosen(): Tier | undefined {
  if (looked) return tier;
  looked = true;

  const page = pageArea();
  if (page != null) tier = { name: 'this page', area: page, limits: LIMITS };
  else {
    const background = backgroundArea();
    if (background != null) tier = { name: 'the background', area: background, limits: LIMITS };
    else {
      const web = webArea();
      if (web != null) {
        tier = { name: "this tab's own session storage", area: web, limits: WEB_LIMITS };
      }
    }
  }
  return tier;
}

function area(): StorageArea | undefined {
  return chosen()?.area;
}

function limits(): Limits {
  return chosen()?.limits ?? LIMITS;
}

/** Which area is in use, or that there is none. For the log */
export function describeStorage(): string {
  return chosen()?.name ?? 'none, nothing will be kept';
}

/** What the area in use will hold, so the caller can refuse early */
export function storageLimits(): Limits {
  return limits();
}

export async function readCached(sha: string, url: string): Promise<string | undefined> {
  const store = area();
  if (store == null) return undefined;

  const key = cacheKey(sha, url);
  try {
    const stored = (await store.get(key))[key] as Partial<Body> | undefined;
    // The commit and the address are held inside the value as well as in the
    // key, the way `useViewed` holds a sha inside what it stores, so anything
    // written by another version reads as absent rather than as content
    if (stored?.v !== VERSION || stored.sha !== sha || stored.url !== url) return undefined;
    if (typeof stored.packed !== 'string') return undefined;

    // Moving it to the front of the queue is not worth making the reader wait
    void touch(key);
    return stored.packed;
  } catch {
    return undefined;
  }
}

/**
 * Takes the answer already packed, because packing it is what decides its size.
 *
 * Says whether it stored. A caller that reports "kept" without asking is a
 * caller that lies whenever the area is missing or the quota is full.
 */
export async function writeCached(sha: string, url: string, packed: string): Promise<boolean> {
  const store = area();
  if (store == null || packed.length > limits().maxEntryChars) return false;

  let stored = false;
  const key = cacheKey(sha, url);
  await withLock(async () => {
    const index = await readIndex(store);
    const plan = planEviction(index.entries, { key, chars: packed.length, usedAt: Date.now() }, limits());
    if (plan == null) return;

    // Freed before the write, so the write is the one with room to succeed
    if (plan.evict.length > 0) await store.remove(plan.evict);

    const body: Body = { v: VERSION, sha, url, packed };
    try {
      // One call, so the index can never name a body that was not written
      await store.set({ [key]: body, [INDEX_KEY]: { v: VERSION, entries: plan.keep } satisfies Index });
      stored = true;
    } catch {
      // Out of quota, most likely. What was evicted is gone either way, so the
      // ledger is corrected to say so rather than left naming it
      const without = plan.keep.filter((entry) => entry.key !== key);
      await store.set({ [INDEX_KEY]: { v: VERSION, entries: without } satisfies Index }).catch(() => {});
    }
  });

  return stored;
}

async function readIndex(store: StorageArea): Promise<Index> {
  try {
    const stored = (await store.get(INDEX_KEY))[INDEX_KEY] as Partial<Index> | undefined;
    if (stored?.v !== VERSION || !Array.isArray(stored.entries)) return { v: VERSION, entries: [] };
    return { v: VERSION, entries: stored.entries.filter(isEntry) };
  } catch {
    return { v: VERSION, entries: [] };
  }
}

function isEntry(value: unknown): value is CacheEntry {
  const entry = value as Partial<CacheEntry> | null;
  return (
    typeof entry?.key === 'string' && typeof entry.chars === 'number' && typeof entry.usedAt === 'number'
  );
}

/** Marks an entry as the most recently read, so eviction takes the others first */
async function touch(key: string): Promise<void> {
  const store = area();
  if (store == null) return;

  await withLock(async () => {
    const index = await readIndex(store);
    const entry = index.entries.find((candidate) => candidate.key === key);
    if (entry == null) return;
    entry.usedAt = Date.now();
    await store.set({ [INDEX_KEY]: index });
  });
}

/**
 * Serialising the read, change, write of the index.
 *
 * There is no compare-and-swap in `storage.session`, and reading then writing
 * is two trips. Two tabs on one pull request can interleave them and lose an
 * update.
 *
 * Two layers. Within this document a promise chain, so nothing here runs
 * against itself whatever the platform offers. Across documents the Web Locks
 * api, which every viewer queues on because they share the extension's origin.
 * The lock is held around arithmetic and two storage calls, never around a
 * download, so it is held for well under a millisecond.
 *
 * Losing it is survivable, which is why there is a fallback at all. A body is
 * addressed by commit and url and is never rewritten with different content, so
 * two writers of one key write the same bytes.
 *
 * A read goes straight to the body and never consults the index, which makes
 * the index a budget ledger rather than a directory. The worst a lost update
 * can do is forget an entry, costing memory until the browser closes, or name
 * one that is gone, which reads as a miss. Neither hands back the wrong diff.
 */
let queue: Promise<void> = Promise.resolve();

function withLock(run: () => Promise<void>): Promise<void> {
  const guarded = async (): Promise<void> => {
    try {
      await run();
    } catch {
      // A blocked storage partition is not worth failing the overlay over
    }
  };

  const locks = (navigator as { locks?: LockManager }).locks;
  const next = queue.then(() =>
    locks?.request == null ? guarded() : locks.request(LOCK_NAME, { mode: 'exclusive' }, guarded),
  );
  // The chain must survive a rejection, or every later write is skipped
  queue = next.catch(() => {});
  return queue;
}
