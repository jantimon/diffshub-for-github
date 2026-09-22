import { BRIDGE_CHANNEL } from '@/bridge';
import { serveGithubFetch } from '@/viewer/files/githubFetch';
import { serveResponseCache } from '@/viewer/files/responseCache';

const GITHUB_ORIGINS = ['https://github.com/*', 'https://*.githubusercontent.com/*'];

async function showHostAccess(): Promise<void> {
  const granted = await browser.permissions.contains({ origins: GITHUB_ORIGINS });
  void browser.action.setTitle({
    title: granted
      ? 'Open this pull request in DiffsHub'
      : 'DiffsHub needs access to github.com. Grant it from the extensions menu.',
  });
  void browser.action.setBadgeText({ text: granted ? '' : '!' });
}

/**
 * Says so on the toolbar button when access to github.com has been taken away.
 *
 * Firefox lets the reader revoke a host permission after installing. When they
 * do, the content script stops running: no marker on the tab, no overlay, and
 * nothing to explain why.
 */
async function watchHostAccess(): Promise<void> {
  browser.permissions.onRemoved.addListener(() => void showHostAccess());
  browser.permissions.onAdded.addListener(() => void showHostAccess());
  await showHostAccess();
}

/** The toolbar button is a second way in, for when the tab strip is off screen */
export default defineBackground(() => {
  if (import.meta.env.FIREFOX) serveGithubFetch();
  /**
   * Unconditional, unlike the fetch proxy. Only Firefox's framed viewer needs
   * it today, and a listener nobody messages costs nothing
   */
  serveResponseCache();
  void watchHostAccess();

  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;
    void browser.tabs.sendMessage(tab.id, { channel: BRIDGE_CHANNEL, type: 'open' }).catch(() => {
      // Not a pull request page, so there is nothing to open
    });
  });
});
