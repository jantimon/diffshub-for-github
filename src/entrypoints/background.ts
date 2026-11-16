import { watchHostAccess } from '@/background/hostAccess';
import { serveResponseCache } from '@/background/sessionCache';
import { serveSignedAddress } from '@/background/signedAddress';
import { BRIDGE_CHANNEL } from '@/shared/bridge';

export default defineBackground(() => {
  if (import.meta.env.FIREFOX) serveSignedAddress();
  /** In both browsers: the viewer keeps its cache here */
  serveResponseCache();
  void watchHostAccess();

  // The toolbar button is a second way in, for when the tab strip is off screen
  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;
    void browser.tabs.sendMessage(tab.id, { channel: BRIDGE_CHANNEL, type: 'open' }).catch(() => {
      // Not a pull request page, so there is nothing to open
    });
  });
});
