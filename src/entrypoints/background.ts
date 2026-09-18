import { BRIDGE_CHANNEL } from '@/bridge';

// The toolbar button is a second way in, for when the tab strip is off screen.
export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.id == null) return;
    void browser.tabs.sendMessage(tab.id, { channel: BRIDGE_CHANNEL, type: 'open' }).catch(() => {
      // Not a pull request page, so there is nothing to open.
    });
  });
});
