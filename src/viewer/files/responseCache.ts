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

const VERSION = 1;
const PREFIX = `diffshub.cache.v${VERSION}.`;
const CHANNEL = 'diffshub-cache';

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

interface Body {
  /** Which shape of this the entry was written in */
  v: number;
  /** The answer, gzipped and then base64'd so it survives being stored as json */
  packed: string;
}

/** The part of `storage.session` this uses */
interface Area {
  get: (keys: string | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

/**
 * The four operations the viewer asks the background for.
 *
 * Always the background, in both browsers. Firefox withholds `browser.storage`
 * from a viewer framed by github.com, and Chrome's viewer has it, but one route
 * is one thing to test: the Chrome suite then runs the same path Firefox does.
 * What crosses is a string, so nothing depends on how a browser serialises a
 * message.
 */
interface Store {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: Body) => Promise<void>;
  usage: () => Promise<number>;
  clear: () => Promise<void>;
}

type Ask =
  | { channel: typeof CHANNEL; op: 'get'; key: string }
  | { channel: typeof CHANNEL; op: 'set'; key: string; value: Body }
  | { channel: typeof CHANNEL; op: 'usage' }
  | { channel: typeof CHANNEL; op: 'clear' };

async function usageOf(area: Area): Promise<number> {
  let chars = 0;
  for (const [key, value] of Object.entries(await area.get(null))) {
    if (key.startsWith(PREFIX)) chars += (value as Partial<Body>).packed?.length ?? 0;
  }
  return chars;
}

async function clearIn(area: Area): Promise<void> {
  const ours = Object.keys(await area.get(null)).filter((key) => key.startsWith(PREFIX));
  if (ours.length > 0) await area.remove(ours);
}

function sessionArea(): Area {
  return browser.storage.session as unknown as Area;
}

async function askBackground(message: Ask): Promise<unknown> {
  return await browser.runtime.sendMessage(message);
}

function throughBackground(): Store {
  return {
    get: (key) => askBackground({ channel: CHANNEL, op: 'get', key }),
    set: async (key, value) => {
      if ((await askBackground({ channel: CHANNEL, op: 'set', key, value })) !== true) {
        throw new Error('the background did not store it');
      }
    },
    usage: async () => Number(await askBackground({ channel: CHANNEL, op: 'usage' })),
    clear: async () => {
      await askBackground({ channel: CHANNEL, op: 'clear' });
    },
  };
}

/** Serves a viewer that has no storage api of its own. Called from the background */
export function serveResponseCache(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, reply: (answer: unknown) => void) => {
      const ask = message as Ask | null;
      if (ask?.channel !== CHANNEL) return undefined;

      const area = sessionArea();
      const run = async (): Promise<unknown> => {
        if (ask.op === 'get') return (await area.get(ask.key))[ask.key];
        if (ask.op === 'usage') return await usageOf(area);
        if (ask.op === 'clear') await clearIn(area);
        else await area.set({ [ask.key]: ask.value });
        return true;
      };

      // Answering later rather than returning a promise: only one of the two
      // browsers waits for a promise here, both wait for this
      void run().then(reply, () => reply(undefined));
      return true;
    },
  );
}

let store: Store | null | undefined;

/** `browser` is named bare because the build rewrites that into an import, and `typeof` keeps it safe in plain node */
function chosen(): Store | null {
  if (store !== undefined) return store;
  try {
    store =
      typeof browser !== 'undefined' && browser.runtime?.sendMessage != null ? throughBackground() : null;
  } catch {
    store = null;
  }
  return store;
}

/** Where copies go, for the log */
export function describeStorage(): string {
  return chosen() == null
    ? 'off, this browser gives the viewer nowhere to keep a copy'
    : "copies are saved in the extension's memory until the browser closes, never on disk";
}

function keyOf(sha: string, url: string): string {
  return `${PREFIX}${sha}.${url}`;
}

/** The compressed answer, or nothing */
export async function readCached(sha: string, url: string): Promise<string | undefined> {
  const found = chosen();
  if (found == null) return undefined;
  try {
    const stored = (await found.get(keyOf(sha, url))) as Partial<Body> | undefined;
    // A value written by another version reads as absent rather than as content
    if (stored?.v !== VERSION || typeof stored.packed !== 'string') return undefined;
    return stored.packed;
  } catch {
    return undefined;
  }
}

/** Says whether it stored, so the log does not report a copy that was never made */
export async function writeCached(sha: string, url: string, packed: string): Promise<boolean> {
  const found = chosen();
  if (found == null || packed.length > BUDGET_CHARS) return false;

  const key = keyOf(sha, url);
  const body: Body = { v: VERSION, packed };
  try {
    if ((await found.usage()) + packed.length > BUDGET_CHARS) await found.clear();
    await found.set(key, body);
    return true;
  } catch {
    // Out of quota after all, most likely. Start from empty once rather than
    // give up on a patch that fits on its own
    try {
      await found.clear();
      await found.set(key, body);
      return true;
    } catch {
      return false;
    }
  }
}
