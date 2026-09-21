import { BRIDGE_CHANNEL } from '@/bridge';

const GITHUB_ORIGINS = ['https://github.com/*', 'https://*.githubusercontent.com/*'];

/**
 * Says so on the toolbar button when access to github.com has been taken away.
 *
 * Firefox lets the reader revoke a host permission after installing. When they
 * do, the content script stops running: no marker on the tab, no overlay, and
 * nothing to explain why.
 */
async function watchHostAccess(): Promise<void> {
  const show = (granted: boolean): void => {
    void browser.action.setTitle({
      title: granted
        ? 'Open this pull request in DiffsHub'
        : 'DiffsHub needs access to github.com. Grant it from the extensions menu.',
    });
    void browser.action.setBadgeText({ text: granted ? '' : '!' });
  };

  browser.permissions.onRemoved.addListener(() => void check());
  browser.permissions.onAdded.addListener(() => void check());

  async function check(): Promise<void> {
    show(await browser.permissions.contains({ origins: GITHUB_ORIGINS }));
  }

  await check();
}

// The toolbar button is a second way in, for when the tab strip is off screen.
export default defineBackground(() => {
  void watchHostAccess();

  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;
    void browser.tabs.sendMessage(tab.id, { channel: BRIDGE_CHANNEL, type: 'open' }).catch(() => {
      // Not a pull request page, so there is nothing to open.
    });
  });
});
