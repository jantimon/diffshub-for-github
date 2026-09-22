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
 * through the background gets 200; a public patch downloads either way.
 *
 * The background script is its own top-level context, so it keeps the real
 * jar. The response is streamed back a chunk at a time, which keeps the patch
 * rendering progressively rather than landing in one lump at the end.
 *
 * A browser test pins this down, because a profile with Total Cookie
 * Protection turned off makes the detour look unnecessary.
 */

const PORT_NAME = 'diffshub-github-fetch';

type Request = { url: string };

type Reply =
  | { type: 'head'; status: number; statusText: string; headers: [string, string][] }
  | { type: 'chunk'; chunk: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; message: string };

/** These statuses are bodyless by spec, so a stream must not be attached */
function allowsBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

export function githubFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!import.meta.env.FIREFOX) {
    return fetch(url, { credentials: 'include', signal });
  }

  return new Promise<Response>((resolve, reject) => {
    const port = browser.runtime.connect({ name: PORT_NAME });
    let settled = false;
    let push: ((reply: Reply) => void) | undefined;
    let pending: Reply[] = [];

    const fail = (reason: Error): void => {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(reason);
    };

    const onAbort = (): void => {
      port.disconnect();
      fail(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onMessage.addListener((message: unknown) => {
      const reply = message as Reply;

      // The head arrives first and decides the Response; everything after it
      // belongs to the body stream, which may not exist yet on this turn
      if (reply.type === 'head') {
        if (settled) return;
        settled = true;

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (next) => {
              if (next.type === 'chunk') controller.enqueue(new Uint8Array(next.chunk));
              else if (next.type === 'end') controller.close();
              else if (next.type === 'error') controller.error(new Error(next.message));
            };
            for (const queued of pending) push(queued);
            pending = [];
          },
          cancel() {
            port.disconnect();
          },
        });

        resolve(
          new Response(allowsBody(reply.status) ? body : null, {
            status: reply.status,
            statusText: reply.statusText,
            headers: reply.headers,
          }),
        );
        return;
      }

      if (reply.type === 'error' && !settled) return fail(new Error(reply.message));
      if (push == null) pending.push(reply);
      else push(reply);
    });

    port.onDisconnect.addListener(() => {
      signal?.removeEventListener('abort', onAbort);
      if (!settled) fail(new Error('The background script closed the connection.'));
      else push?.({ type: 'end' });
    });

    port.postMessage({ url } satisfies Request);
  });
}

/**
 * Serves {@link githubFetch} from the background script. Firefox only: on every
 * other browser the viewer fetches for itself and nothing connects here.
 */
export function serveGithubFetch(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());

    const send = (reply: Reply): boolean => {
      try {
        port.postMessage(reply);
        return true;
      } catch {
        // The viewer went away mid-stream, which is ordinary: the reader closed
        // the overlay or navigated away
        controller.abort();
        return false;
      }
    };

    port.onMessage.addListener((message: unknown) => {
      void (async () => {
        try {
          const response = await fetch((message as Request).url, {
            credentials: 'include',
            signal: controller.signal,
          });
          const headers: [string, string][] = [...response.headers];
          if (
            !send({
              type: 'head',
              status: response.status,
              statusText: response.statusText,
              headers,
            })
          ) {
            return;
          }

          const reader = response.body?.getReader();
          if (reader != null) {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value != null && !send({ type: 'chunk', chunk: value })) return;
            }
          }
          send({ type: 'end' });
        } catch (error) {
          if (controller.signal.aborted) return;
          send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
  });
}
