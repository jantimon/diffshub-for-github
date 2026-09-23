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

import {
  BRIDGE_CHANNEL,
  failedReply,
  isToViewer,
  type Ask,
  type FromViewer,
  type Reply,
  type RequestName,
} from '@/shared/bridge';
import { fromPage, postToPage } from '@/viewer/bridge/postToPage';

const TIMEOUT_MS = 20_000;

/**
 * Requests that are many round trips to GitHub rather than one. Reading the
 * comments walks up to twenty pages in a row, which a slow afternoon can take
 * past the usual limit on a busy pull request
 */
const LONGER_MS: Partial<Record<RequestName, number>> = { threads: 60_000 };

let nextId = 0;

export function ask<K extends RequestName>(
  name: K,
  // A request whose `ask` is `void` is called with the name alone
  ...[payload]: Ask<K> extends void ? [] : [ask: Ask<K>]
): Promise<Reply<K>> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent): void => {
      const message = event.data;
      if (!fromPage(event) || !isToViewer(message) || message.type !== 'response' || message.id !== id)
        return;
      finish(message.reply as Reply<K>);
    };

    const timer = setTimeout(
      () => finish(failedReply[name]('GitHub did not answer in time.')),
      LONGER_MS[name] ?? TIMEOUT_MS,
    );

    function finish(reply: Reply<K>): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(reply);
    }

    addEventListener('message', onMessage);
    // The table pairs each name with its payload, which TypeScript cannot follow
    // across the generic, so the pairing is asserted here once
    postToPage({ channel: BRIDGE_CHANNEL, type: 'request', id, name, ask: payload } as FromViewer);
  });
}
