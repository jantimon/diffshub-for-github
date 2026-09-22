import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from '@pierre/diffs/react';
import { useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import { IconEye, IconEyeSlash } from '@pierre/icons';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ReviewThread } from '@/bridge';
import { createFileLoader } from '@/viewer/files/fileLoader';
import { blameUrl, blobUrl, copyPath, type FileRefs } from '@/viewer/files/fileLinks';
import { filesUrl, patchUrl, GITHUB_ORIGIN, type PullRequestRef } from '@/pullRequest';
import { usePatchStream } from '@/patch/usePatchStream';
import { ask } from '@/viewer/ask';
import { BinaryCompare, isImagePath } from '@/viewer/files/BinaryCompare';
import { CommentComposer } from '@/viewer/comments/CommentComposer';
import { ReviewDialog } from '@/viewer/review/ReviewDialog';
import { ShortcutHelp } from '@/viewer/shell/ShortcutHelp';
import { Sidebar } from '@/viewer/shell/Sidebar';
import { Thread } from '@/viewer/comments/Thread';
import { Toolbar } from '@/viewer/shell/Toolbar';
import { useThreads } from '@/viewer/comments/useThreads';
import { ToastStack, useToasts } from '@/viewer/shell/Toast';
import { closeViewer, usePageInfo } from '@/viewer/shell/usePageInfo';
import { useNavigation } from '@/viewer/diff/useNavigation';
import { useThemeSurfaces } from '@/viewer/shell/useThemeSurfaces';
import { useShortcuts } from '@/viewer/shell/useShortcuts';
import { useViewed } from '@/viewer/review/useViewed';
import { readSetting, useChoice, writeSetting } from '@/viewer/settings';
import {
  ANNOTATION_CSS,
  DIFF_TINT_CSS,
  HEADER_CSS,
  HIGHLIGHTER_OPTIONS,
  POOL_OPTIONS,
  SEPARATOR_CSS,
  TREE_CSS,
} from '@/viewer/diff/codeViewStyles';

export function Overlay({ pr, openedAtSha }: { pr: PullRequestRef; openedAtSha?: string }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <Viewer pr={pr} openedAtSha={openedAtSha} />
    </WorkerPoolContextProvider>
  );
}

function Viewer({ pr, openedAtSha }: { pr: PullRequestRef; openedAtSha?: string }) {
  const page = usePageInfo();
  const toasts = useToasts();
  const pushToast = toasts.push;
  const viewerRef = useRef<CodeViewHandle<ReviewThread, undefined> | null>(null);

  const [layout = 'split', setLayout] = useChoice('layout', ['split', 'unified'] as const, 'split');
  const [sidebar = 'open', setSidebar] = useChoice('sidebar', ['open', 'closed'] as const, 'open');
  const [whitespace = 'show', setWhitespace] = useChoice('whitespace', ['show', 'ignore'] as const, 'show');
  const diffStyle = layout;
  const sidebarOpen = sidebar === 'open';
  const ignoreWhitespace = whitespace === 'ignore';

  const [sidebarWidth, setSidebarWidth] = useState(() => Number(readSetting('sidebarWidth', '280')) || 280);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      let width = sidebarWidth;
      const onMove = (move: globalThis.PointerEvent) => {
        width = Math.min(Math.max(sidebarWidth + move.clientX - startX, 160), 720);
        setSidebarWidth(width);
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        writeSetting('sidebarWidth', String(width));
      };
      document.body.style.cursor = 'col-resize';
      addEventListener('pointermove', onMove);
      addEventListener('pointerup', onUp);
    },
    [sidebarWidth],
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Reading code in light while GitHub sits in dark is a fair preference, so
  // once this is set it wins over the page. Light or dark, nothing automatic:
  // no stored choice means the page decides
  const [themeChoice, setThemeChoice] = useChoice('theme', ['light', 'dark'] as const, undefined);
  const [comparing, setComparing] = useState<string | undefined>(undefined);

  const [includeInput, setIncludeInput] = useState(() => readSetting('include', ''));
  const [excludeInput, setExcludeInput] = useState(() => readSetting('exclude', ''));

  const [include, setInclude] = useState(includeInput);
  const [exclude, setExclude] = useState(excludeInput);
  const [includeCase, setIncludeCase] = useState(() => readSetting('includeCase', '') === 'on');
  const [includeRegex, setIncludeRegex] = useState(() => readSetting('includeRegex', '') === 'on');
  const [excludeCase, setExcludeCase] = useState(() => readSetting('excludeCase', '') === 'on');
  const [excludeRegex, setExcludeRegex] = useState(() => readSetting('excludeRegex', '') === 'on');

  // Memoised on the flags themselves: a fresh object every render would look
  // like a filter change and republish the whole view on every keystroke
  const includeOptions = useMemo(
    () => ({ caseSensitive: includeCase, regex: includeRegex }),
    [includeCase, includeRegex],
  );
  const excludeOptions = useMemo(
    () => ({ caseSensitive: excludeCase, regex: excludeRegex }),
    [excludeCase, excludeRegex],
  );

  useEffect(() => {
    writeSetting('includeCase', includeCase ? 'on' : '');
    writeSetting('includeRegex', includeRegex ? 'on' : '');
    writeSetting('excludeCase', excludeCase ? 'on' : '');
    writeSetting('excludeRegex', excludeRegex ? 'on' : '');
  }, [includeCase, includeRegex, excludeCase, excludeRegex]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInclude(includeInput);
      setExclude(excludeInput);
      writeSetting('include', includeInput);
      writeSetting('exclude', excludeInput);
    }, 250);
    return () => clearTimeout(timer);
  }, [includeInput, excludeInput]);

  const viewedRef = useRef<ReadonlySet<string>>(new Set());
  const decorationRef = useRef<{
    viewed: ReadonlySet<string>;
    folders: ReadonlyMap<string, { total: number; viewed: number }>;
  }>({ viewed: new Set(), folders: new Map() });

  /**
   * Which item in the diff each path belongs to, kept by the patch stream and
   * read by the tree. It is declared here rather than returned by the stream
   * because the tree's callbacks are built first and both of them need it.
   */
  const pathToItemIdRef = useRef<ReadonlyMap<string, string>>(new Map());

  const onSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    if (selectedPaths.length !== 1) return;
    const [path] = selectedPaths;
    if (path == null) return;
    const itemId = pathToItemIdRef.current.get(path);
    if (itemId == null) return;
    viewerRef.current?.scrollTo({ type: 'item', id: itemId, align: 'start', behavior: 'smooth' });
  }, []);

  const { model } = useFileTree({
    id: 'diffshub-tree',
    paths: [],
    gitStatus: [],
    presorted: true,
    sort: () => 0,
    search: true,
    stickyFolders: true,
    flattenEmptyDirectories: true,
    initialExpansion: 'open',
    itemHeight: 24,
    unsafeCSS: TREE_CSS,
    onSelectionChange,
    renderRowDecoration({ item }) {
      const { viewed: seen, folders } = decorationRef.current;
      const pathToItemId = pathToItemIdRef.current;
      if (item.kind === 'file') {
        const id = pathToItemId.get(item.path);
        if (id == null || !seen.has(id)) return null;
        return { text: '✓', title: 'Viewed' };
      }
      // The tree names a folder with a trailing slash. The tally is keyed by
      // the path as it appears in the patch, which has none
      const folder = folders.get(item.path.replace(/\/$/, ''));
      if (folder == null || folder.total === 0 || folder.viewed < folder.total) return null;
      return { text: '✓', title: `All ${folder.total} files viewed` };
    },
  });
  const search = useFileTreeSearch(model);

  const { state, items, visibleRef } = usePatchStream({
    url: patchUrl(pr),
    sha: openedAtSha,
    /**
     * The commit belongs in the key: the viewer library caches its rendering
     * of each file under it, and the same position names different content
     * once the branch moves
     */
    cacheKeyPrefix: `${pr.owner}/${pr.repo}/${pr.number}@${openedAtSha ?? 'unknown'}`,
    include,
    exclude,
    includeOptions,
    excludeOptions,
    ignoreWhitespace,
    model,
    pathToItemIdRef,
  });

  const navigation = useNavigation(viewerRef, visibleRef);
  const { viewed, toggle, baseSha } = useViewed(
    `${pr.owner}/${pr.repo}/${pr.number}`,
    openedAtSha,
    pushToast,
  );

  // A folder is marked once every file under it has been read
  const folders = useMemo(() => {
    const tally = new Map<string, { total: number; viewed: number }>();
    for (const [path, id] of state.pathToItemId) {
      const seen = viewed.has(id);
      const segments = path.split('/');
      for (let depth = 1; depth < segments.length; depth += 1) {
        const folder = segments.slice(0, depth).join('/');
        const entry = tally.get(folder) ?? { total: 0, viewed: 0 };
        entry.total += 1;
        if (seen) entry.viewed += 1;
        tally.set(folder, entry);
      }
    }
    return tally;
  }, [state.pathToItemId, viewed]);

  const viewedOnShow = useMemo(() => {
    let count = 0;
    for (const id of state.pathToItemId.values()) if (viewed.has(id)) count += 1;
    return count;
  }, [state.pathToItemId, viewed]);

  decorationRef.current = { viewed, folders };
  viewedRef.current = viewed;

  // Decorations are worked out as rows render, so redraw when a file is ticked
  // off rather than waiting for the next scroll
  const drawnViewed = useRef(viewed);
  useEffect(() => {
    if (drawnViewed.current === viewed) return;
    drawnViewed.current = viewed;
    model.render({});
  });

  /**
   * Ticking a file off moves to the next one still to read and puts the
   * keyboard on its eye, so the whole review is space, read, space. Files
   * already read are skipped: stopping on one would mean ticking it off again
   * or stepping past it by hand. Unticking a file leaves you on it, because
   * you went back to it on purpose.
   */
  const markViewed = useCallback(
    (id: string) => {
      // Read through a ref: the header this button lives in is rendered by the
      // viewer and can hold an older copy of this callback
      const wasViewed = viewedRef.current.has(id);
      const files = visibleRef.current;
      toggle(id, files.find((file) => file.item.id === id)?.path ?? id);
      if (wasViewed) return;
      const from = files.findIndex((file) => file.item.id === id);
      const seen = viewedRef.current;
      const next =
        files.slice(from + 1).find((file) => !seen.has(file.item.id)) ??
        // Nothing unread below, so fall back to anything unread above: the
        // reader may have worked through the list out of order
        files.slice(0, from).find((file) => !seen.has(file.item.id));
      if (next == null) return;
      viewerRef.current?.scrollTo({ type: 'item', id: next.item.id, align: 'start', behavior: 'smooth' });
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-dh-viewed="${CSS.escape(next.item.id)}"]`)?.focus();
      }, 350);
    },
    [toggle, viewedRef, visibleRef],
  );

  useShortcuts({
    ...navigation,
    toggleViewed: useCallback(() => {
      const file = visibleRef.current[navigation.currentIndex()];
      if (file != null) markViewed(file.item.id);
    }, [markViewed, navigation, visibleRef]),
    focusFilter: useCallback(() => search.open(), [search]),
    toggleHelp: useCallback(() => setHelpOpen((open) => !open), []),
    close: closeViewer,
  });

  const comments = useThreads(items, pushToast);
  const { closeDraft, openDraft, post, reply, resolve, edit, remove } = comments;
  const hideComments = comments.hidden;

  /**
   * The wrapper is what the card measures itself against. The cell the viewer
   * slots this into is half a window wide in a split diff and a whole one in a
   * unified diff, and the card has to read well in both.
   */
  const renderAnnotation = useCallback(
    (annotation: { metadata?: ReviewThread }) => {
      const thread = annotation.metadata;
      if (thread == null) return null;
      return (
        <div className="dh-annotation">
          {thread.isDraft === true ? (
            <CommentComposer
              side={thread.side}
              onCancel={closeDraft}
              onSubmit={async (text) => {
                const failed = await post(thread, text);
                if (failed != null) pushToast(failed);
                return failed == null;
              }}
            />
          ) : (
            <Thread
              thread={thread}
              onReply={(body) => reply(thread, body)}
              onResolve={() => resolve(thread)}
              onEdit={edit}
              onDelete={remove}
            />
          )}
        </div>
      );
    },
    [closeDraft, edit, post, pushToast, remove, reply, resolve],
  );

  const reportedError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== 'error' || state.error == null) return;
    if (reportedError.current === state.error) return;
    reportedError.current = state.error;
    pushToast(state.error, { label: 'Open on GitHub', href: filesUrl(pr) });
  }, [state.phase, state.error, pushToast, pr]);

  // The two revisions a binary file is compared across. Without the base there
  // is nothing to compare against, so the viewer shows the new file alone
  // rather than the same image twice under two headings
  const refs = useMemo<FileRefs | undefined>(
    () =>
      openedAtSha == null ? undefined : { owner: pr.owner, repo: pr.repo, baseSha, headSha: openedAtSha },
    [baseSha, openedAtSha, pr.owner, pr.repo],
  );

  const loadDiffFiles = useMemo(
    () => (openedAtSha == null ? undefined : createFileLoader(pr, openedAtSha)),
    [openedAtSha, pr],
  );

  // An open eye means still to read, a closed one means done. A button rather
  // than a tick box, so space works on it the same way and reviewing a pull
  // request is space, read, space
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<ReviewThread>) => {
      const isViewed = viewed.has(item.id);
      return (
        <button
          type="button"
          className="dh-viewed"
          data-dh-viewed={item.id}
          aria-pressed={isViewed}
          title={isViewed ? 'Mark as not viewed' : 'Mark as viewed'}
          onClick={() => markViewed(item.id)}
        >
          {isViewed ? <IconEyeSlash size={14} /> : <IconEye size={14} />}
        </button>
      );
    },
    [markViewed, viewed],
  );

  const copyToClipboard = useCallback(
    async (path: string) => {
      const copied = await copyPath(path);
      pushToast(copied ? 'Path copied.' : 'The clipboard is blocked here.');
    },
    [pushToast],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<ReviewThread>) => {
      if (item.type !== 'diff') return null;
      const path = item.fileDiff.name;
      const moved = item.fileDiff.type === 'rename-pure' || item.fileDiff.type === 'rename-changed';
      const isBinary = item.fileDiff.hunks.length === 0;
      return (
        <span className="dh-file-links">
          {moved && <span className="dh-moved">MOVED</span>}
          {refs != null && isBinary && isImagePath(path) && (
            <button type="button" onClick={() => setComparing(path)}>
              Compare
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void copyToClipboard(path);
            }}
          >
            Copy path
          </button>
          {refs != null && (
            <>
              <a href={blobUrl(refs, path, 'head')} target="_top">
                File
              </a>
              <a href={blameUrl(refs, path)} target="_top">
                Blame
              </a>
            </>
          )}
        </span>
      );
    },
    [copyToClipboard, refs],
  );

  const options = useMemo<CodeViewReactOptions<ReviewThread, undefined>>(
    () => ({
      layout: { paddingTop: 0, gap: 1, paddingBottom: 0 },
      diffStyle,
      themeType: themeChoice ?? page.themeType,
      theme: { light: page.lightTheme, dark: page.darkTheme },
      stickyHeaders: true,
      overflow: 'scroll',
      lineHoverHighlight: 'number',
      enableLineSelection: true,
      enableGutterUtility: !hideComments,
      onGutterUtilityClick(
        range: { start: number; side?: string },
        context: { item: CodeViewItem<ReviewThread> },
      ) {
        const item = context.item;
        if (item.type !== 'diff') return;
        openDraft(item.fileDiff.name, range.start, range.side === 'deletions' ? 'deletions' : 'additions');
      },
      unsafeCSS: `${HEADER_CSS}\n${SEPARATOR_CSS}\n${DIFF_TINT_CSS}\n${ANNOTATION_CSS}`,
      loadDiffFiles,
    }),
    [
      diffStyle,
      themeChoice,
      page.themeType,
      page.lightTheme,
      page.darkTheme,
      loadDiffFiles,
      openDraft,
      hideComments,
    ],
  );

  const toggleLayout = useCallback(
    () => setLayout(layout === 'split' ? 'unified' : 'split'),
    [layout, setLayout],
  );

  const toggleSidebar = useCallback(
    () => setSidebar(sidebarOpen ? 'closed' : 'open'),
    [sidebarOpen, setSidebar],
  );

  const toggleWhitespace = useCallback(
    () => setWhitespace(ignoreWhitespace ? 'show' : 'ignore'),
    [ignoreWhitespace, setWhitespace],
  );

  const themeType = themeChoice ?? page.themeType;
  const themeName = themeType === 'dark' ? page.darkTheme : page.lightTheme;
  const surfaces = useThemeSurfaces(themeName);

  const toggleTheme = useCallback(
    () => setThemeChoice(themeType === 'dark' ? 'light' : 'dark'),
    [setThemeChoice, themeType],
  );
  const { stats } = state;

  return (
    /* `colorScheme` is what makes `light-dark` in the viewer's own stylesheet
       pick the right value, and it gives the scrollbars and the form controls
       the same scheme as the diff */
    <div
      className="dh-overlay"
      data-theme={themeType}
      data-layout={layout}
      style={{ colorScheme: themeType, ...surfaces.overlay }}
    >
      <Toolbar
        pr={pr}
        page={page}
        stats={stats}
        viewedOnShow={viewedOnShow}
        loading={state.phase === 'loading'}
        sidebarOpen={sidebarOpen}
        diffStyle={diffStyle}
        themeType={themeType}
        ignoreWhitespace={ignoreWhitespace}
        hideComments={hideComments}
        onToggleSidebar={toggleSidebar}
        onToggleWhitespace={toggleWhitespace}
        onToggleComments={comments.toggleHidden}
        onToggleLayout={toggleLayout}
        onToggleTheme={toggleTheme}
        onFinishReview={() => setReviewOpen(true)}
        onShowHelp={() => setHelpOpen(true)}
        onClose={closeViewer}
      />

      <div className="dh-body">
        <Sidebar
          open={sidebarOpen}
          width={sidebarWidth}
          model={model}
          // The tree's own stylesheet follows the system until the theme resolves
          treeSurface={{ colorScheme: themeType, ...surfaces.tree }}
          stats={stats}
          include={includeInput}
          exclude={excludeInput}
          includeError={state.includeError}
          excludeError={state.excludeError}
          hiddenCount={state.hiddenCount}
          spacingOnlyCount={state.spacingOnlyCount}
          includeCase={includeCase}
          includeRegex={includeRegex}
          excludeCase={excludeCase}
          excludeRegex={excludeRegex}
          onIncludeChange={setIncludeInput}
          onExcludeChange={setExcludeInput}
          onIncludeCase={() => setIncludeCase((on) => !on)}
          onIncludeRegex={() => setIncludeRegex((on) => !on)}
          onExcludeCase={() => setExcludeCase((on) => !on)}
          onExcludeRegex={() => setExcludeRegex((on) => !on)}
        />
        {sidebarOpen && (
          <div
            className="dh-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the file tree"
            onPointerDown={startResize}
          />
        )}
        <CodeView<ReviewThread, undefined>
          ref={viewerRef}
          className="dh-code"
          items={comments.items}
          options={options}
          renderAnnotation={renderAnnotation}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderMetadata={renderHeaderMetadata}
        />
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {reviewOpen && (
        <ReviewDialog
          repo={`${pr.owner}/${pr.repo}`}
          number={pr.number}
          title={page.title}
          url={`${GITHUB_ORIGIN}/${pr.owner}/${pr.repo}/pull/${pr.number}`}
          viewed={viewedOnShow}
          total={stats.fileCount}
          onViewRemaining={() => {
            // Jump to the first file still to be read
            const next = visibleRef.current.find((file) => !viewed.has(file.item.id));
            if (next == null) return;
            viewerRef.current?.scrollTo({
              type: 'item',
              id: next.item.id,
              align: 'start',
              behavior: 'smooth',
            });
          }}
          onClose={() => setReviewOpen(false)}
          onSubmit={async (verdict, body) => {
            const result = await ask('review', { event: verdict, body });
            if (!result.ok) return result.error ?? 'GitHub refused the review.';
            pushToast('Review submitted.');
            void comments.reload();
            return undefined;
          }}
        />
      )}
      {comparing != null && refs != null && (
        <BinaryCompare refs={refs} path={comparing} onClose={() => setComparing(undefined)} />
      )}
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
