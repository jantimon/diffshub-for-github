import { BRIDGE_CHANNEL, isToViewer } from '@/bridge';

const TIMEOUT_MS = 15_000;
let nextId = 0;

/** Asks the GitHub page to render markdown the way it will appear once posted. */
export function requestPreview(text: string): Promise<{ html?: string; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'preview-result' || message.id !== id) return;
      finish({ html: message.html, error: message.error });
    };

    const timer = setTimeout(() => finish({ error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { html?: string; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'preview', id, text }, '*');
  });
}
