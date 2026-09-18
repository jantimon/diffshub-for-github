import { BRIDGE_CHANNEL, isFromViewer, type PageInfo } from '@/bridge';
import {
  filesPaths,
  findFilesChangedLink,
  findFilesChangedTab,
  readBranchPair,
  readHeadSha,
  readPullRequestRef,
  readPullRequestTitle,
  type PullRequestRef,
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
    const open = (pr: PullRequestRef): void => {
      if (frame != null) return;

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

    browser.runtime.onMessage.addListener((message: { channel?: string; type?: string }) => {
      if (message?.channel !== BRIDGE_CHANNEL || message.type !== 'open') return;
      const pr = readPullRequestRef();
      if (pr != null) open(pr);
    });

    // Listening on the document rather than on the tab means a re-render cannot
    // drop the handler, and it covers every route to the diff -- the tab strip,
    // the file count in the timeline, the sidebar.
    document.addEventListener(
      'click',
      (event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const pr = readPullRequestRef();
        if (pr == null || findFilesChangedLink(event.target, pr) == null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(pr);
      },
      true
    );

    // The marker is drawn with a stylesheet keyed on the link's own href, so
    // GitHub can re-render the tab strip as often as it likes without losing it.
    const markTab = (): void => {
      const pr = readPullRequestRef();
      if (pr == null) return;

      const style = document.getElementById(MARKER_ATTRIBUTE) ?? document.createElement('style');
      style.id = MARKER_ATTRIBUTE;
      const selectors = filesPaths(pr).flatMap((path) => {
        const value = path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        return [`a[href="${value}"]::after`, `a[href="${GITHUB_ORIGIN_PREFIX}${value}"]::after`];
      });
      const badge = browser.runtime.getURL('/icon/32.png');
      style.textContent = `${selectors.join(', ')} {
        content: "";
        display: inline-block;
        width: 14px;
        height: 14px;
        margin-left: 6px;
        vertical-align: -3px;
        background-image: url("${badge}");
        background-size: contain;
        background-repeat: no-repeat;
      }`;
      document.head.append(style);

      // Kept for the tooltip and so tests have something to click.
      const tab = findFilesChangedTab(pr);
      if (tab == null || tab.hasAttribute(MARKER_ATTRIBUTE)) return;
      tab.setAttribute(MARKER_ATTRIBUTE, 'true');
      tab.title = 'Opens the DiffsHub viewer. Cmd- or Ctrl-click for GitHub’s own view.';
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

const GITHUB_ORIGIN_PREFIX = 'https://github.com';
