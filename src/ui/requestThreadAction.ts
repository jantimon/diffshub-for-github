import { BRIDGE_CHANNEL, isToViewer } from '@/bridge';

const TIMEOUT_MS = 20_000;
let nextId = 0;

type Ask =
  | { type: 'reply'; inReplyTo: string; body: string }
  | { type: 'resolve'; threadId: string; resolved: boolean };

/** Asks the GitHub page to reply to a comment, or resolve a conversation. */
export function requestThreadAction(ask: Ask): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'thread-result' || message.id !== id) return;
      finish({ ok: message.ok, error: message.error });
    };

    const timer = setTimeout(() => finish({ ok: false, error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { ok: boolean; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, ...ask, id }, '*');
  });
}
