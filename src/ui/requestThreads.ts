import { BRIDGE_CHANNEL, isToViewer, type ReviewThread } from '@/bridge';

const TIMEOUT_MS = 20_000;
let nextId = 0;

/** Asks the GitHub page for the review comments on this pull request. */
export function requestThreads(): Promise<{ threads: ReviewThread[]; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'threads-result' || message.id !== id) return;
      finish({ threads: message.threads, error: message.error });
    };

    const timer = setTimeout(() => finish({ threads: [], error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { threads: ReviewThread[]; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'threads', id }, '*');
  });
}
