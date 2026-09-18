import { BRIDGE_CHANNEL, isFromViewer, type PageInfo } from '@/bridge';
import {
  findFilesChangedTab,
  readBranchPair,
  readHeadSha,
  readPullRequestRef,
  readPullRequestTitle,
} from '@/github/pr';
import { readGitHubTheme } from '@/github/theme';

const MARKER_ATTRIBUTE = 'data-diffshub-marked';
const FRAME_ID = 'diffshub-for-github-viewer';

export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*'],
  runAt: 'document_idle',

  main(ctx) {
    let frame: HTMLIFrameElement | undefined;
    let previousOverflow = '';

    const close = (): void => {
      if (frame == null) return;
      frame.remove();
      frame = undefined;
      document.documentElement.style.overflow = previousOverflow;
    };

    const collectPageInfo = (): PageInfo => {
      const theme = readGitHubTheme();
      const branches = readBranchPair();
      return {
        title: readPullRequestTitle(),
        themeType: theme.themeType,
        lightTheme: theme.theme.light,
        darkTheme: theme.theme.dark,
        base: branches?.base,
        head: branches?.head,
        headSha: readHeadSha(),
      };
    };

    // The viewer runs as an extension page rather than in this content script.
    // That gives it the extension's own origin: real module workers, code
    // splitting, and a credentialed fetch to github.com under host permissions.
    const open = (): void => {
      const pr = readPullRequestRef();
      if (pr == null || frame != null) return;

      const url = new URL(browser.runtime.getURL('/viewer.html'));
      url.searchParams.set('owner', pr.owner);
      url.searchParams.set('repo', pr.repo);
      url.searchParams.set('number', String(pr.number));

      frame = document.createElement('iframe');
      frame.id = FRAME_ID;
      frame.src = url.toString();
      frame.setAttribute('allow', 'clipboard-write');
      frame.style.cssText =
        'position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;z-index:2147483000;color-scheme:normal';

      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.append(frame);
    };

    addEventListener('message', (event: MessageEvent) => {
      if (frame == null || event.source !== frame.contentWindow) return;
      if (!isFromViewer(event.data)) return;

      if (event.data.type === 'ready') {
        frame.contentWindow?.postMessage(
          { channel: BRIDGE_CHANNEL, type: 'page-info', info: collectPageInfo() },
          '*'
        );
        return;
      }
      close();
    });

    // Taking over the click stops GitHub rendering its own diff at all, which is
    // most of the cost on a large pull request.
    const onTabClick = (event: MouseEvent): void => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      open();
    };

    const markTab = (): void => {
      const tab = findFilesChangedTab();
      if (tab == null || tab.hasAttribute(MARKER_ATTRIBUTE)) return;
      tab.setAttribute(MARKER_ATTRIBUTE, 'true');
      tab.title = 'Opens the DiffsHub viewer. Cmd- or Ctrl-click for GitHub’s own view.';
      const marker = document.createElement('span');
      marker.textContent = ' ⚡';
      marker.setAttribute('aria-hidden', 'true');
      tab.append(marker);
      tab.addEventListener('click', onTabClick, true);
    };

    markTab();

    // GitHub swaps the page body on client-side navigation, so the tab has to be
    // found again each time.
    const observer = new MutationObserver(() => markTab());
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      close();
    });
  },
});
