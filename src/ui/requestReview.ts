import { BRIDGE_CHANNEL, isToViewer, type ReviewEvent } from '@/bridge';

const TIMEOUT_MS = 20_000;
let nextId = 0;

/** Asks the GitHub page to submit a review. */
export function requestReview(event: ReviewEvent, body: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (message: MessageEvent) => {
      const data = message.data;
      if (!isToViewer(data) || data.type !== 'review-result' || data.id !== id) return;
      finish({ ok: data.ok, error: data.error });
    };

    const timer = setTimeout(() => finish({ ok: false, error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { ok: boolean; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'review', id, event, body }, '*');
  });
}
