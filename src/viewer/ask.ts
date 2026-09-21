/**
 * Asking the GitHub page to do something, from inside the viewer.
 *
 * One function for every request in the bridge's table. The name picks the
 * types: what has to be passed, and what comes back.
 *
 * Every request gives up after a while rather than waiting for ever. The page
 * underneath can be navigated away, and an extension reload tears the content
 * script off a page that stays open, and in both cases no answer is ever
 * coming. A reader who is told is better off than one left watching a spinner.
 */

import { BRIDGE_CHANNEL, isToViewer, type Ask, type Reply, type RequestName } from '@/bridge';

const TIMEOUT_MS = 20_000;

/**
 * What each request answers with when the page does not. The shapes differ, so
 * this is a table rather than one value, and the compiler checks it covers
 * every request.
 */
const TIMED_OUT: { [K in RequestName]: (error: string) => Reply<K> } = {
  viewed: (error) => ({ paths: [], error }),
  'file-review': (error) => ({ ok: false, error }),
  threads: (error) => ({ threads: [], truncated: false, error }),
  comment: (error) => ({ ok: false, error }),
  reply: (error) => ({ ok: false, error }),
  resolve: (error) => ({ ok: false, error }),
  review: (error) => ({ ok: false, error }),
  preview: (error) => ({ error }),
};

let nextId = 0;

export function ask<K extends RequestName>(
  name: K,
  // A request whose `ask` is `void` is called with the name alone.
  ...[payload]: Ask<K> extends void ? [] : [ask: Ask<K>]
): Promise<Reply<K>> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent): void => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'response' || message.id !== id) return;
      finish(message.reply as Reply<K>);
    };

    const timer = setTimeout(() => finish(TIMED_OUT[name]('GitHub did not answer in time.')), TIMEOUT_MS);

    function finish(reply: Reply<K>): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(reply);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'request', id, name, ask: payload }, '*');
  });
}
