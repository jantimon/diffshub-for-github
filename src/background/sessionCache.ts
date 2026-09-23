import { CACHE_CHANNEL, CACHE_PREFIX, type CacheAsk } from '@/shared/runtime';
import { fromViewer } from './sender';

/**
 * Keeps the viewer's patch cache in `storage.session`: in memory, shared across
 * tabs, gone when the browser closes, never on disk. The viewer asks for it
 * over messages in both browsers, because Firefox withholds `browser.storage`
 * from a viewer framed by github.com. The policy (budget, keys, what is kept)
 * lives with the viewer in `src/viewer/net/responseCache.ts`, and this only stores.
 */

/** The part of `storage.session` this uses */
interface Area {
  get: (keys: string | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

function sessionArea(): Area {
  return browser.storage.session as unknown as Area;
}

async function usageOf(area: Area): Promise<number> {
  let chars = 0;
  for (const [key, value] of Object.entries(await area.get(null))) {
    if (key.startsWith(CACHE_PREFIX) && typeof value === 'string') chars += value.length;
  }
  return chars;
}

async function clearIn(area: Area): Promise<void> {
  const ours = Object.keys(await area.get(null)).filter((key) => key.startsWith(CACHE_PREFIX));
  if (ours.length > 0) await area.remove(ours);
}

/** Only the viewer page, and only keys of the cache's own */
function allowed(ask: CacheAsk, sender: Parameters<typeof fromViewer>[0]): boolean {
  if (!fromViewer(sender)) return false;
  return (ask.op !== 'get' && ask.op !== 'set') || ask.key.startsWith(CACHE_PREFIX);
}

export function serveResponseCache(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: Parameters<typeof fromViewer>[0], reply: (answer: unknown) => void) => {
      const ask = message as CacheAsk | null;
      if (ask?.channel !== CACHE_CHANNEL) return undefined;
      if (!allowed(ask, sender)) {
        reply(undefined);
        return undefined;
      }

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
