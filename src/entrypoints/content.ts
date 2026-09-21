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
import { readThreads } from '@/github/readThreads';
import { readViewed } from '@/github/readViewed';
import { replyToComment, resolveThread } from '@/github/threadActions';
import { submitReview } from '@/github/submitReview';
import { writeComment } from '@/github/writeComment';
import { readGitHubTheme } from '@/github/theme';

const MARKER_ATTRIBUTE = 'data-diffshub-marked';
const FRAME_ID = 'diffshub-for-github-viewer';

export default defineContentScript({
  // Every github.com page, not just pull requests. GitHub routes client side, so
  // arriving at a pull request from the list, the dashboard or a notification is
  // a history navigation with no document load: a `/pull/*` match pattern would
  // never inject on any of them, and the tab would only be marked after a
  // reload. Everything below is a no-op off a pull request, and the extension
  // already holds `https://github.com/*`, so this asks for nothing new.
  matches: ['https://github.com/*'],
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

      if (event.data.type === 'file-review') {
        const { id, path, viewed } = event.data;
        void reviewFile(path, viewed).then((status) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'file-review-result', id, ok: status === 200, status },
            '*'
          );
        });
        return;
      }

      if (event.data.type === 'reply' || event.data.type === 'resolve') {
        const message = event.data;
        const pr = readPullRequestRef();
        const request =
          pr == null
            ? Promise.resolve({ ok: false, error: 'Not a pull request page.' })
            : message.type === 'reply'
              ? replyToComment(pr, message.inReplyTo, message.body)
              : resolveThread(pr, message.threadId, message.resolved);
        void request.then((result) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'thread-result', id: message.id, ...result },
            '*'
          );
        });
        return;
      }

      if (event.data.type === 'review') {
        const { id, event: verdict, body } = event.data;
        const pr = readPullRequestRef();
        const headSha = readHeadSha();
        const request =
          pr == null || headSha == null
            ? Promise.resolve({ ok: false, error: 'Could not tell which commit to review.' })
            : submitReview(pr.owner, pr.repo, pr.number, headSha, verdict, body);
        void request.then((result) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'review-result', id, ...result },
            '*'
          );
        });
        return;
      }

      if (event.data.type === 'comment') {
        const { id, comment } = event.data;
        const pr = readPullRequestRef();
        const request =
          pr == null
            ? Promise.resolve({ ok: false, error: 'Not a pull request page.' })
            : writeComment(pr.owner, pr.repo, pr.number, comment);
        void request.then((result) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'comment-result', id, ...result },
            '*'
          );
        });
        return;
      }

      if (event.data.type === 'viewed') {
        const { id } = event.data;
        const pr = readPullRequestRef();
        const request =
          pr == null
            ? Promise.resolve({ paths: [], error: 'Not a pull request page.' })
            : readViewed(pr.owner, pr.repo, pr.number);
        void request.then((result) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'viewed-result', id, paths: result.paths, error: result.error },
            '*'
          );
        });
        return;
      }

      if (event.data.type === 'threads') {
        const { id } = event.data;
        const pr = readPullRequestRef();
        const request =
          pr == null
            ? Promise.resolve({ threads: [], error: 'Not a pull request page.' })
            : readThreads(pr.owner, pr.repo, pr.number);
        void request.then((result) => {
          frame?.contentWindow?.postMessage(
            { channel: BRIDGE_CHANNEL, type: 'threads-result', id, ...result },
            '*'
          );
        });
        return;
      }

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

    // GitHub refuses a write that does not come from its own origin, so the
    // viewer asks this script to make it.
    const reviewFile = async (path: string, viewed: boolean): Promise<number> => {
      const pr = readPullRequestRef();
      if (pr == null) return 0;
      try {
        const response = await fetch(`/${pr.owner}/${pr.repo}/pull/${pr.number}/file_review`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            'github-verified-fetch': 'true',
          },
          body: JSON.stringify({ path, viewed: viewed ? 'viewed' : 'unviewed' }),
        });
        return response.status;
      } catch {
        return 0;
      }
    };

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

    // An overlay open over one pull request has no business surviving a route
    // change to another, or to anywhere that is not a pull request at all.
    let markedPath = readPullRequestRef()?.number;
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const next = readPullRequestRef()?.number;
      if (next !== markedPath) close();
      markedPath = next;
      markTab();
    });

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
