/**
 * Whether a message comes from the extension's own viewer page.
 *
 * Only the extension's own pages can reach the background today, but that is a
 * fact about the browser, not a rule this code states. Saying it here means a
 * future page of ours, or a content script, cannot use the credentialed fetch
 * or the cache by accident.
 */
export function fromViewer(sender: { id?: string; url?: string } | undefined): boolean {
  if (sender?.id !== browser.runtime.id || sender.url == null) return false;
  return sender.url.startsWith(browser.runtime.getURL('/viewer.html'));
}
