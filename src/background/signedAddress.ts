import { GITHUB_ORIGIN } from '@/shared/pullRequest';
import { ADDRESS_CHANNEL, type AddressAsk } from '@/shared/runtime';

/** The redirect and the page's ask come from two processes, in either order */
const PATIENCE_MS = 5_000;

function keyOf(tabId: number, url: string): string {
  return `${tabId} ${url}`;
}

/** Gives the page the address of a redirect that the page cannot follow itself */
export function serveSignedAddress(): void {
  // The reader can revoke host access, and `webRequest` with it. The rest of
  // the background must still start
  if (browser.webRequest == null) return;

  /** Addresses that arrived before anyone asked, and asks that arrived first */
  const seen = new Map<string, string>();
  const waiting = new Map<string, (address: string | undefined) => void>();

  // Not `onBeforeRedirect`: it fires only for a redirect that is followed
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0 || details.statusCode < 300 || details.statusCode > 399) return;
      const location = details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === 'location',
      )?.value;
      if (location == null) return;
      // A `location` may be relative, and the viewer is on another origin
      const address = new URL(location, details.url).href;

      const key = keyOf(details.tabId, details.url);
      const waiter = waiting.get(key);
      if (waiter != null) {
        waiting.delete(key);
        waiter(address);
        return;
      }
      seen.set(key, address);
      // Almost no redirect here is ours, so none is kept past the wait
      setTimeout(() => seen.delete(key), PATIENCE_MS);
    },
    { urls: [`${GITHUB_ORIGIN}/*`] },
    ['responseHeaders'],
  );

  browser.runtime.onMessage.addListener(
    (message: unknown, sender: { tab?: { id?: number } }, reply: (answer: unknown) => void) => {
      const ask = message as AddressAsk | null;
      if (ask?.channel !== ADDRESS_CHANNEL) return undefined;

      // A tab gets only its own redirects
      const tabId = sender.tab?.id;
      if (tabId == null) {
        reply(undefined);
        return true;
      }

      const key = keyOf(tabId, ask.url);
      const ready = seen.get(key);
      if (ready != null) {
        seen.delete(key);
        reply(ready);
        return true;
      }

      const timer = setTimeout(() => {
        waiting.delete(key);
        reply(undefined);
      }, PATIENCE_MS);
      waiting.set(key, (address) => {
        clearTimeout(timer);
        reply(address);
      });
      return true;
    },
  );
}
