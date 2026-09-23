import {
  BRIDGE_CHANNEL,
  failedReply,
  isFromViewer,
  type Ask,
  type PageInfo,
  type Reply,
  type RequestName,
} from '@/bridge';
import { filesPaths, pullPath, readPullRequestRef, GITHUB_ORIGIN, type PullRequestRef } from '@/pullRequest';
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
import { deleteComment, editComment, replyToComment, resolveThread } from '@/page/threadActions';
import { submitReview } from '@/page/submitReview';
import { writeComment } from '@/page/writeComment';
import { writeViewed } from '@/page/writeViewed';
import { readGitHubTheme } from '@/page/theme';

const MARKER_ATTRIBUTE = 'data-diffshub-marked';

/**
 * How long a hidden overlay is kept before its memory is let go.
 *
 * Long enough that stepping out to the conversation and back is free, short
 * enough that a tab left open all day is not holding a parsed diff nobody is
 * reading.
 */
const HIDDEN_BEFORE_RELEASE_MS = 5 * 60 * 1000;
const FRAME_ID = 'diffshub-for-github-viewer';

/** The pull request the page is on, as its path, or nothing off a pull request */
const currentPull = (): string | undefined => {
  const pr = readPullRequestRef();
  return pr == null ? undefined : pullPath(pr);
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
    author: readAuthor(),
  };
};

// The marker is drawn with a stylesheet keyed on the link's own href, so
// GitHub can re-render the tab strip as often as it likes without losing it
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

  // The attribute carries the tooltip and gives the tests something to click
  const tab = findFilesChangedTab(pr);
  if (tab == null || tab.hasAttribute(MARKER_ATTRIBUTE)) return;
  tab.setAttribute(MARKER_ATTRIBUTE, 'true');
  tab.title = 'Opens the DiffsHub viewer. Cmd- or Ctrl-click for GitHub’s own view.';
};

export default defineContentScript({
  /**
   * Every github.com page, not just pull requests. GitHub routes client side,
   * so reaching a pull request from the list, the dashboard or a notification
   * is a history navigation with no document load: a `/pull/*` match pattern
   * would never inject on any of them, and the tab would only be marked after
   * a reload
   *
   * Everything below does nothing off a pull request, and the extension
   * already holds `https://github.com/*`, so this asks for nothing new
   */
  matches: ['https://github.com/*'],
  runAt: 'document_idle',

  main(ctx) {
    let frame: HTMLIFrameElement | undefined;
    let previousOverflow = '';
    let release: ReturnType<typeof setTimeout> | undefined;
    /**
     * Where the keyboard was before the overlay opened, to put it back after.
     * While open, the keyboard is in the viewer: a key pressed here would reach
     * a page nobody can see, and Cmd+F would open the browser's find over it
     */
    let focusedBefore: Element | null = null;

    /**
     * Focusing the iframe from here marks it active but leaves the keys with
     * this page, in Chrome at least. The viewer focusing its own window is what
     * moves them, so it is asked to, now and again once it has loaded
     */
    const askViewerToFocus = (): void => {
      frame?.contentWindow?.postMessage({ channel: BRIDGE_CHANNEL, type: 'focus' }, '*');
    };

    const takeFocus = (): void => {
      focusedBefore = document.activeElement;
      frame?.focus();
      askViewerToFocus();
    };

    const giveFocusBack = (): void => {
      if (focusedBefore instanceof HTMLElement) focusedBefore.focus({ preventScroll: true });
      focusedBefore = null;
    };

    const showing = (): boolean => frame != null && frame.style.display !== 'none';

    /**
     * Puts the overlay away without throwing it out.
     *
     * Removing the iframe would throw away the parsed patch, the rendered diff
     * and every conversation with it, so coming back would pay for the whole
     * download again: twenty megabytes, on a large pull request, to read
     * something open a moment ago.
     *
     * Hidden, it holds that memory, so it is let go after a while. Moving to
     * another pull request drops it at once, because none of it applies there.
     */
    const hide = (): void => {
      if (frame == null) return;
      frame.style.display = 'none';
      document.documentElement.style.overflow = previousOverflow;
      giveFocusBack();
      clearTimeout(release);
      release = setTimeout(destroy, HIDDEN_BEFORE_RELEASE_MS);
    };

    const destroy = (): void => {
      clearTimeout(release);
      release = undefined;
      if (frame == null) return;
      const wasShowing = showing();
      frame.remove();
      frame = undefined;
      document.documentElement.style.overflow = previousOverflow;
      if (wasShowing) giveFocusBack();
    };

    // The viewer runs as an extension page rather than in this content script,
    // which gives it the extension's own origin: real module workers, code
    // splitting, and a credentialed fetch to github.com under host permissions
    const open = (pr: PullRequestRef): void => {
      if (showing()) return;

      // Still there from last time, with the diff as it was left
      if (frame != null) {
        clearTimeout(release);
        release = undefined;
        frame.style.display = '';
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        takeFocus();
        return;
      }

      const url = new URL(browser.runtime.getURL('/viewer.html'));
      url.searchParams.set('owner', pr.owner);
      url.searchParams.set('repo', pr.repo);
      url.searchParams.set('number', String(pr.number));
      /**
       * The commit the page is showing, read out of markup GitHub has already
       * embedded. It travels on the url rather than over the bridge because the
       * viewer needs it at its first render: the bridge answers a tick later,
       * by which time the patch is already downloading
       */
      const openedAtSha = readHeadSha();
      if (openedAtSha != null) url.searchParams.set('sha', openedAtSha);
      // Light or dark, for the same reason: a first frame painted from the
      // system's preference flashes whenever GitHub is set the other way
      url.searchParams.set('theme', readGitHubTheme().themeType);

      frame = document.createElement('iframe');
      frame.id = FRAME_ID;
      frame.src = url.toString();
      frame.setAttribute('allow', 'clipboard-write');
      frame.style.cssText =
        'position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;z-index:2147483000;color-scheme:normal';

      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.append(frame);
      takeFocus();
    };

    // Everything the viewer can ask for. One entry per request in the bridge's
    // table, so a missing or misnamed handler is a compile error rather than a
    // message that goes unanswered
    const handlers: {
      [K in RequestName]: (ask: Ask<K>, pr: PullRequestRef) => Promise<Reply<K>>;
    } = {
      viewed: (_ask, pr) => readViewed(pr),
      'file-review': ({ path, viewed }, pr) => writeViewed(pr, path, viewed),
      threads: (_ask, pr) => readThreads(pr),
      comment: (comment, pr) => writeComment(pr, comment),
      reply: ({ inReplyTo, body }, pr) => replyToComment(pr, inReplyTo, body),
      resolve: ({ threadId, resolved }, pr) => resolveThread(pr, threadId, resolved),
      'edit-comment': ({ databaseId, body }, pr) => editComment(pr, databaseId, body),
      'delete-comment': ({ databaseId }, pr) => deleteComment(pr, databaseId),
      review: async ({ event, body }, pr) => {
        const headSha = readHeadSha();
        if (headSha == null) return { ok: false, error: 'Could not tell which commit to review.' };
        return submitReview(pr, headSha, event, body);
      },
      preview: ({ text }) => previewMarkdown(text),
    };

    ctx.addEventListener(window, 'message', async (event: MessageEvent) => {
      if (frame == null || event.source !== frame.contentWindow) return;
      if (!isFromViewer(event.data)) return;
      const message = event.data;

      if (message.type === 'close') {
        hide();
        return;
      }

      if (message.type === 'ready') {
        if (showing()) askViewerToFocus();
        frame.contentWindow?.postMessage(
          { channel: BRIDGE_CHANNEL, type: 'page-info', info: collectPageInfo() },
          '*',
        );
        return;
      }

      if (message.type !== 'request') return;

      const { id, name } = message;
      const pr = readPullRequestRef();
      // The table is keyed by the same name that types the payload, which
      // TypeScript cannot follow across a lookup, so this is the one place the
      // pairing is asserted rather than checked
      const reply =
        pr == null
          ? failedReply[name]('Not a pull request page.')
          : await (handlers[name] as (ask: unknown, pr: PullRequestRef) => Promise<Reply<typeof name>>)(
              message.ask,
              pr,
            );

      frame?.contentWindow?.postMessage({ channel: BRIDGE_CHANNEL, type: 'response', id, name, reply }, '*');
    });

    browser.runtime.onMessage.addListener((message: { channel?: string; type?: string }) => {
      if (message?.channel !== BRIDGE_CHANNEL || message.type !== 'open') return;
      const pr = readPullRequestRef();
      if (pr != null) open(pr);
    });

    // Listening on the document rather than on the tab means a re-render cannot
    // drop the handler, and it covers every route to the diff: the tab strip,
    // the file count in the timeline, the sidebar
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
      true,
    );

    markTab();

    // An overlay open over one pull request has no business surviving a route
    // change to another, or to anywhere that is not a pull request at all. The
    // whole path counts: #5 in one repository is not #5 in another
    let openedOn = currentPull();
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      const next = currentPull();
      if (next !== openedOn) destroy();
      openedOn = next;
      markTab();
    });

    // GitHub swaps the page body on client-side navigation, so the tab has to
    // be found again each time
    const observer = new MutationObserver(() => markTab());
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      destroy();
    });
  },
});
