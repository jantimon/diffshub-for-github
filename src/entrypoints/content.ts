import {
  BRIDGE_CHANNEL,
  isFromViewer,
  type Ask,
  type PageInfo,
  type Reply,
  type RequestName,
} from '@/bridge';
import { filesPaths, readPullRequestRef, GITHUB_ORIGIN, type PullRequestRef } from '@/pullRequest';
import {
  findFilesChangedLink,
  findFilesChangedTab,
  readAuthor,
  readBranchPair,
  readHeadSha,
  readPullRequestTitle,
} from '@/page/pageInfo';
import { readThreads } from '@/page/readThreads';
import { previewMarkdown } from '@/page/previewMarkdown';
import { readViewed } from '@/page/readViewed';
import { replyToComment, resolveThread } from '@/page/threadActions';
import { submitReview } from '@/page/submitReview';
import { writeComment } from '@/page/writeComment';
import { writeViewed } from '@/page/writeViewed';
import { readGitHubTheme } from '@/page/theme';

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
        author: readAuthor(),
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

    // Everything the viewer can ask for. One entry per request in the bridge's
    // table, so a missing or misnamed handler is a compile error rather than a
    // message that goes unanswered.
    const handlers: {
      [K in RequestName]: (ask: Ask<K>, pr: PullRequestRef) => Promise<Reply<K>>;
    } = {
      viewed: (_ask, pr) => readViewed(pr),
      'file-review': ({ path, viewed }, pr) => writeViewed(pr, path, viewed),
      threads: (_ask, pr) => readThreads(pr),
      comment: (comment, pr) => writeComment(pr, comment),
      reply: ({ inReplyTo, body }, pr) => replyToComment(pr, inReplyTo, body),
      resolve: ({ threadId, resolved }, pr) => resolveThread(pr, threadId, resolved),
      review: async ({ event, body }, pr) => {
        const headSha = readHeadSha();
        if (headSha == null) return { ok: false, error: 'Could not tell which commit to review.' };
        return submitReview(pr, headSha, event, body);
      },
      preview: ({ text }) => previewMarkdown(text),
    };

    /** What every request answers with when the page is no longer a pull request. */
    const NOT_A_PULL_REQUEST: { [K in RequestName]: Reply<K> } = {
      viewed: { paths: [], error: 'Not a pull request page.' },
      'file-review': { ok: false, error: 'Not a pull request page.' },
      threads: { threads: [], truncated: false, error: 'Not a pull request page.' },
      comment: { ok: false, error: 'Not a pull request page.' },
      reply: { ok: false, error: 'Not a pull request page.' },
      resolve: { ok: false, error: 'Not a pull request page.' },
      review: { ok: false, error: 'Not a pull request page.' },
      preview: { error: 'Not a pull request page.' },
    };

    ctx.addEventListener(window, 'message', (event: MessageEvent) => {
      if (frame == null || event.source !== frame.contentWindow) return;
      if (!isFromViewer(event.data)) return;
      const message = event.data;

      if (message.type === 'close') {
        close();
        return;
      }

      if (message.type === 'ready') {
        frame.contentWindow?.postMessage(
          { channel: BRIDGE_CHANNEL, type: 'page-info', info: collectPageInfo() },
          '*'
        );
        return;
      }

      if (message.type !== 'request') return;

      const { id, name } = message;
      const pr = readPullRequestRef();
      const answer =
        pr == null
          ? Promise.resolve(NOT_A_PULL_REQUEST[name])
          : // The table is keyed by the same name that types the payload, which
            // TypeScript cannot follow across a lookup, so this is the one place
            // the pairing is asserted rather than checked.
            (handlers[name] as (ask: unknown, pr: PullRequestRef) => Promise<Reply<typeof name>>)(message.ask, pr);

      void answer.then((reply) => {
        frame?.contentWindow?.postMessage({ channel: BRIDGE_CHANNEL, type: 'response', id, name, reply }, '*');
      });
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
        return [`a[href="${value}"]::after`, `a[href="${GITHUB_ORIGIN}${value}"]::after`];
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
