import { BRIDGE_CHANNEL, isToViewer, type NewComment } from '@/bridge';

const TIMEOUT_MS = 20_000;
let nextId = 0;

/** Asks the GitHub page to post a review comment. */
export function requestComment(comment: NewComment): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'comment-result' || message.id !== id) return;
      finish({ ok: message.ok, error: message.error });
    };

    const timer = setTimeout(() => finish({ ok: false, error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { ok: boolean; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'comment', id, comment }, '*');
  });
}
