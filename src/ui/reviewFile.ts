import { BRIDGE_CHANNEL, isToViewer } from '@/bridge';

const TIMEOUT_MS = 10_000;
let nextId = 0;

/**
 * Asks the GitHub page to record a file as viewed.
 *
 * GitHub answers 422 to a write that carries any origin but its own, so the
 * viewer cannot make this call itself. The content script runs on github.com
 * and makes it there.
 */
export function requestFileReview(path: string, viewed: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'file-review-result' || message.id !== id) return;
      finish(message.ok);
    };

    const timer = setTimeout(() => finish(false), TIMEOUT_MS);

    function finish(ok: boolean): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(ok);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'file-review', id, path, viewed }, '*');
  });
}
