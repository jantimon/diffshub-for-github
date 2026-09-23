import { FETCH_PORT, type FetchReply, type FetchRequest } from '@/shared/runtime';

/**
 * Fetches github.com from the viewer with the reader's own session.
 *
 * On Chrome the viewer's own `fetch` carries the session cookie and this is
 * nothing but `fetch` with credentials.
 *
 * Firefox needs the detour. The viewer is an extension iframe inside a
 * github.com page, and Total Cookie Protection (on by default, which is
 * `network.cookie.cookieBehavior` 5) partitions its cookie jar by the
 * top-level site.
 *
 * Every github.com request from there leaves signed out. On a private pull
 * request the framed viewer gets 404 for the patch and the same request
 * through the background gets 200. A public patch downloads either way.
 *
 * The background script is its own top-level context, so it keeps the real
 * jar. `src/background/fetchProxy.ts` fetches there and streams the answer back
 * a chunk at a time, so the patch still renders as it arrives.
 *
 * A browser test pins this down, because a profile with Total Cookie
 * Protection turned off makes the detour look unnecessary.
 */

/** These statuses are bodyless by spec, so a stream must not be attached */
function allowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

export function githubFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!import.meta.env.FIREFOX) {
    return fetch(url, { credentials: 'include', signal });
  }

  return new Promise<Response>((resolve, reject) => {
    const port = browser.runtime.connect({ name: FETCH_PORT });
    let settled = false;
    let push: ((reply: FetchReply) => void) | undefined;
    /** The background said it reached the end, rather than the port simply going */
    let finished = false;
    let pending: FetchReply[] = [];

    const fail = (reason: Error): void => {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(reason);
    };

    const onAbort = (): void => {
      // Disconnecting does not fire this side's own `onDisconnect`, so the body
      // has to be ended here or every reader of it waits for ever
      push?.({ type: 'error', message: 'Aborted' });
      port.disconnect();
      fail(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onMessage.addListener((message: unknown) => {
      const reply = message as FetchReply;

      // The head arrives first and decides the Response. Everything after it
      // belongs to the body stream, which may not exist yet on this turn
      if (reply.type === 'head') {
        if (settled) return;

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (next) => {
              if (next.type === 'chunk') controller.enqueue(new Uint8Array(next.chunk));
              else if (next.type === 'end') {
                finished = true;
                controller.close();
              } else if (next.type === 'error' && !finished) controller.error(new Error(next.message));
            };
            for (const queued of pending) push(queued);
            pending = [];
          },
          cancel() {
            port.disconnect();
          },
        });

        // Settled only once the Response exists. A status or header the
        // constructor refuses would otherwise throw here, inside the port's
        // listener, and leave the caller waiting for ever
        try {
          const response = new Response(allowsBody(reply.status) ? body : null, {
            status: reply.status,
            statusText: reply.statusText,
            headers: reply.headers,
          });
          settled = true;
          resolve(response);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }

      if (reply.type === 'error' && !settled) return fail(new Error(reply.message));
      if (push == null) pending.push(reply);
      else push(reply);
    });

    port.onDisconnect.addListener(() => {
      signal?.removeEventListener('abort', onAbort);
      if (!settled) {
        fail(new Error('The background script closed the connection.'));
        return;
      }
      /**
       * A body that stopped is not a body that finished.
       *
       * Closing the stream here would hand the reader a short answer that looks
       * complete, and the cache would keep those few files under the commit's
       * key and serve them as the whole diff for the rest of the session.
       *
       * The background says `end` when it reaches the end. Anything else
       * arriving here is the connection going away mid-download, which a
       * background that is an event page can do at any moment.
       */
      push?.({ type: 'error', message: 'The background script stopped before the download finished.' });
    });

    port.postMessage({ url } satisfies FetchRequest);
  });
}
