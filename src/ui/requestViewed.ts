import { BRIDGE_CHANNEL, isToViewer } from '@/bridge';

const TIMEOUT_MS = 20_000;
let nextId = 0;

/** Asks the GitHub page which files it already has marked as viewed. */
export function requestViewed(): Promise<{ paths: string[]; error?: string }> {
  return new Promise((resolve) => {
    const id = (nextId += 1);

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isToViewer(message) || message.type !== 'viewed-result' || message.id !== id) return;
      finish({ paths: message.paths, error: message.error });
    };

    const timer = setTimeout(() => finish({ paths: [], error: 'GitHub did not answer in time.' }), TIMEOUT_MS);

    function finish(result: { paths: string[]; error?: string }): void {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(result);
    }

    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'viewed', id }, '*');
  });
}
