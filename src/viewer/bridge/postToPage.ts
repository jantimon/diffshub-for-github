import type { FromViewer } from '@/shared/bridge';
import { GITHUB_ORIGIN } from '@/shared/pullRequest';

/**
 * Sends a message to the GitHub page the viewer is framed in. Addressed to
 * github.com by name, so if the frame ever sat anywhere else the message would
 * go nowhere rather than to whoever is there
 */
export function postToPage(message: FromViewer): void {
  parent.postMessage(message, GITHUB_ORIGIN);
}

/** Whether a message came from that page, rather than any other window */
export function fromPage(event: MessageEvent): boolean {
  return event.source === parent && event.origin === GITHUB_ORIGIN;
}
