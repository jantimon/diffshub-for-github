import { describeError } from '@/shared/errors';
import { FETCH_PORT, isGithubUrl, type FetchReply, type FetchRequest } from '@/shared/runtime';
import { fromViewer } from './sender';

/**
 * Fetches github.com for the viewer, on Firefox, with the background's cookie
 * jar. `src/viewer/net/githubFetch.ts` says why the viewer cannot, and
 * `docs/firefox.md` has the measurements.
 *
 * The answer goes back a chunk at a time, so the patch still renders as it
 * arrives. Only the viewer page may ask, and only for GitHub's own hosts: the
 * request carries the reader's session.
 */
export function serveGithubFetch(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== FETCH_PORT) return;
    if (!fromViewer(port.sender)) {
      port.disconnect();
      return;
    }

    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());

    const send = (reply: FetchReply): boolean => {
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
      const { url } = message as FetchRequest;
      if (typeof url !== 'string' || !isGithubUrl(url)) {
        send({ type: 'error', message: 'Only GitHub is fetched from here.' });
        return;
      }
      void (async () => {
        try {
          const response = await fetch(url, { credentials: 'include', signal: controller.signal });
          const head: FetchReply = {
            type: 'head',
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers],
          };
          if (!send(head)) return;

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
          send({ type: 'error', message: describeError(error) });
        }
      })();
    });
  });
}
