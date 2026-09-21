import { DEFAULT_THEMES } from '@pierre/diffs';
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import { FileTree, useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import {
  IconBrandGithub,
  IconColorDark,
  IconColorLight,
  IconDiffSplit,
  IconParagraph,
  IconDiffUnified,
  IconEye,
  IconEyeSlash,
  IconCheck,
  IconQuestion,
  IconSidebarLeft,
  IconX,
} from '@pierre/icons';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import type { ReviewThread } from '@/bridge';
import { createFileLoader } from '@/github/fileLoader';
import { blameUrl, blobUrl, copyPath, type FileRefs } from '@/github/fileLinks';
import { filesUrl, patchUrl, GITHUB_ORIGIN, type PullRequestRef } from '@/github/pr';
import type { DiffStats } from '@/patch/accumulator';
import { usePatchStream } from '@/patch/usePatchStream';
import { ask } from './ask';
import { BinaryCompare, isImagePath } from './BinaryCompare';
import { CommentComposer } from './CommentComposer';
import { ReviewDialog } from './ReviewDialog';
import { ShortcutHelp } from './ShortcutHelp';
import { Thread } from './Thread';
import { ToastStack, useToasts } from './Toast';
import { closeViewer, usePageInfo } from './usePageInfo';
import { useNavigation } from './useNavigation';
import { useThemeSurfaces } from './useThemeSurfaces';
import { useShortcuts } from './useShortcuts';
import { useViewed } from './useViewed';
import { readSetting, writeSetting } from './storage';

const POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 1) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
};

const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  langs: ['tsx', 'typescript', 'css', 'go', 'python', 'rust', 'sh', 'cpp'],
};

// A moved file's only signal is its header, so give the old path and the arrow
// enough weight to catch the eye while scrolling.
// The tree carries its own generous indents; tightening them buys back the
// width that deep paths need.
const TREE_STYLE = {
  '--trees-density-override': 0.9,
  '--trees-padding-inline-override': 0,
  '--trees-item-padding-x-override': 2,
  '--trees-git-renamed-color-override': 'light-dark(#0969da, #4493f8)',
} as CSSProperties;

const TREE_CSS = `
[data-file-tree-search-container] {
  padding-inline: 0;
  margin-right: 0;
}
[data-file-tree-virtualized-scroll='true'] {
  padding-inline-start: 0;
}

/* A folder's tick is fainter than a file's: it is a summary of what is inside
   rather than something ticked off by hand. */
[data-item-type='folder'] [data-item-section='decoration'] {
  opacity: 0.45;
}
`;

/*
 * The bar reads as a heading rather than a control: a bare chevron and a count.
 * Clicking the label already reveals the whole gap, while the chevrons step
 * through it, so the label is marked as clickable and given a verb. Nothing
 * here may change a row's height -- the viewer measures them.
 */
const SEPARATOR_CSS = `
[data-unmodified-lines] {
  cursor: pointer;
  border-radius: 4px;
}

[data-unmodified-lines]:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
  text-decoration: underline;
}

[data-separator]:hover [data-expand-button] {
  opacity: 1;
}

[data-unmodified-lines]::before {
  content: 'Show ';
}
`;

const HEADER_CSS = `
[data-diffs-header] [data-header-content] {
  align-items: center;
}

[data-diffs-header] slot[name='header-prefix'] {
  display: inline-flex;
  align-items: center;
  line-height: 0;
}

[data-prev-name],
[data-rename-icon] {
  color: light-dark(#0969da, #4493f8);
  font-weight: 600;
  opacity: 1;
}

[data-diffs-header]:has([data-prev-name]) [data-title] {
  font-weight: 600;
}
`;

export function Overlay({ pr }: { pr: PullRequestRef }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <Viewer pr={pr} />
    </WorkerPoolContextProvider>
  );
}

function DiffStatsPanel({ stats }: { stats: DiffStats }) {
  const churn = stats.addedLines + stats.deletedLines;
  const addedShare = churn === 0 ? 0 : Math.round((stats.addedLines / churn) * 100);

  return (
    <section className="dh-diffstats">
      <div className="dh-diffstats-bar" role="img" aria-label={`${addedShare}% of changed lines are additions`}>
        <span className="dh-diffstats-added" style={{ width: `${addedShare}%` }} />
        <span className="dh-diffstats-deleted" style={{ width: `${100 - addedShare}%` }} />
      </div>
      <div className="dh-diffstats-figures">
        <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
        <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
      </div>
      <div className="dh-diffstats-totals">
        <span>{stats.fileCount.toLocaleString()} files</span>
        <span>{stats.totalLines.toLocaleString()} lines</span>
      </div>
    </section>
  );
}

function Viewer({ pr }: { pr: PullRequestRef }) {
  const page = usePageInfo();
  const toasts = useToasts();
  const viewerRef = useRef<CodeViewHandle<ReviewThread, undefined> | null>(null);

  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(() =>
    readSetting('layout', 'split') === 'unified' ? 'unified' : 'split'
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => readSetting('sidebar', 'open') !== 'closed');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(() => readSetting('whitespace', 'show') === 'ignore');

  const [sidebarWidth, setSidebarWidth] = useState(() => Number(readSetting('sidebarWidth', '280')) || 280);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    const onMove = (move: globalThis.PointerEvent) => {
      setSidebarWidth(Math.min(Math.max(startWidth + move.clientX - startX, 160), 720));
    };
    const onUp = () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      writeSetting('sidebarWidth', String(sidebarWidthRef.current));
    };
    document.body.style.cursor = 'col-resize';
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Reading code in light while GitHub sits in dark is a fair preference, so
  // once this is set it wins over the page. Light or dark, nothing automatic.
  const [themeChoice, setThemeChoice] = useState<'light' | 'dark' | undefined>(() => {
    const stored = readSetting('theme', '');
    return stored === 'light' || stored === 'dark' ? stored : undefined;
  });
  const [comparing, setComparing] = useState<string | undefined>(undefined);

  const [includeInput, setIncludeInput] = useState(() => readSetting('include', ''));
  const [excludeInput, setExcludeInput] = useState(() => readSetting('exclude', ''));
  const [include, setInclude] = useState(includeInput);
  const [exclude, setExclude] = useState(excludeInput);

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
      // The tree names a folder with a trailing slash; the tally is keyed by
      // the path as it appears in the patch, which has none.
      const folder = folders.get(item.path.replace(/\/$/, ''));
      if (folder == null || folder.total === 0 || folder.viewed < folder.total) return null;
      return { text: '✓', title: `All ${folder.total} files viewed` };
    },
  });
  const search = useFileTreeSearch(model);

  const { state, items, visibleRef, pathToItemIdRef } = usePatchStream({
    url: patchUrl(pr),
    cacheKeyPrefix: `${pr.owner}/${pr.repo}/${pr.number}`,
    include,
    exclude,
    ignoreWhitespace,
    model,
  });

  const navigation = useNavigation(viewerRef, visibleRef);
  const { viewed, toggle, baseSha } = useViewed(
    `${pr.owner}/${pr.repo}/${pr.number}`,
    page.headSha,
    useCallback((message: string) => toasts.push(message), [toasts])
  );

  // A folder is marked once every file under it has been read.
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
  // off rather than waiting for the next scroll.
  const firstDraw = useRef(true);
  useEffect(() => {
    if (firstDraw.current) {
      firstDraw.current = false;
      return;
    }
    model.render({});
  }, [viewed, model]);

  // Ticking a file off moves to the next one still to read and puts the
  // keyboard on its eye, so the whole review is space, read, space. Files
  // already read are skipped: stopping on one would mean ticking it off again
  // or stepping past it by hand. Unticking a file leaves you on it, because
  // you went back to it on purpose.
  const markViewed = useCallback(
    (id: string) => {
      // Read through a ref: the header this button lives in is rendered by the
      // viewer and can hold an older copy of this callback.
      const wasViewed = viewedRef.current.has(id);
      const files = visibleRef.current;
      toggle(id, files.find((file) => file.item.id === id)?.path ?? id);
      if (wasViewed) return;
      const from = files.findIndex((file) => file.item.id === id);
      const seen = viewedRef.current;
      const next =
        files.slice(from + 1).find((file) => !seen.has(file.item.id)) ??
        // Nothing unread below, so fall back to anything unread above: the
        // reader may have worked through the list out of order.
        files.slice(0, from).find((file) => !seen.has(file.item.id));
      if (next == null) return;
      viewerRef.current?.scrollTo({ type: 'item', id: next.item.id, align: 'start', behavior: 'smooth' });
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-dh-viewed="${CSS.escape(next.item.id)}"]`)?.focus();
      }, 350);
    },
    [toggle, viewedRef, visibleRef]
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

  const [threads, setThreads] = useState<readonly ReviewThread[]>([]);
  const [draft, setDraft] = useState<ReviewThread | undefined>(undefined);
  const askedForThreads = useRef(false);
  const pushToast = toasts.push;
  useEffect(() => {
    if (askedForThreads.current) return;
    askedForThreads.current = true;
    void ask('threads').then((result) => {
      setThreads(result.threads);
      if (result.error != null) pushToast(`Comments: ${result.error}`);
      else if (result.truncated) {
        pushToast('GitHub returned only the most recent comments on this pull request.');
      }
    });
  }, [pushToast]);

  // The viewer ignores an item whose version it has already seen, and the
  // version is worked out from the item the stream produced, so it has to
  // count up by itself rather than from what that item carries.
  const annotationRevision = useRef(0);

  // Annotations live on the item, so hang each thread on the file it belongs to.
  const itemsWithThreads = useMemo(() => {
    annotationRevision.current += 1;
    const all = draft == null ? threads : [...threads, draft];
    if (all.length === 0) return items;
    const byPath = new Map<string, ReviewThread[]>();
    for (const thread of all) {
      const list = byPath.get(thread.path);
      if (list == null) byPath.set(thread.path, [thread]);
      else list.push(thread);
    }
    return items.map((item) => {
      if (item.type !== 'diff') return item;
      const list = byPath.get(item.fileDiff.name);
      if (list == null) return item;
      return {
        ...item,
        annotations: list
          .map((thread) => ({
            side: thread.side,
            // A comment on the file, or one whose lines have since changed,
            // goes to the top of the file rather than to a line it no longer
            // fits.
            lineNumber: thread.isOutdated || thread.line == null ? 0 : thread.line,
            metadata: thread,
          }))
          .sort((a, b) => a.lineNumber - b.lineNumber),
        version: (item.version ?? 0) + annotationRevision.current,
      };
    });
  }, [draft, items, threads]);

  const reloadThreads = useCallback(() => {
    void ask('threads').then((result) => setThreads(result.threads));
  }, []);

  const renderAnnotation = useCallback(
    (annotation: { metadata?: ReviewThread }) => {
      const thread = annotation.metadata;
      if (thread == null) return null;
      if (thread.isDraft !== true) {
        return (
          <Thread
            thread={thread}
            onReply={async (body) => {
              // A reply answers the first comment in the thread, which is what
              // GitHub's own reply form names.
              const inReplyTo = thread.comments[0]?.databaseId ?? '';
              const result = await ask('reply', { inReplyTo, body });
              if (!result.ok) return result.error ?? 'GitHub refused the reply.';
              reloadThreads();
              return undefined;
            }}
            onResolve={async () => {
              const result = await ask('resolve', { threadId: thread.id });
              if (!result.ok) return result.error ?? 'GitHub refused that.';
              reloadThreads();
              return undefined;
            }}
          />
        );
      }
      return (
        <CommentComposer
          onCancel={() => setDraft(undefined)}
          onSubmit={async (text) => {
            const result = await ask('comment', {
              path: thread.path,
              line: thread.line ?? 0,
              side: thread.side,
              text,
            });
            if (!result.ok) {
              toasts.push(result.error ?? 'GitHub refused the comment.');
              return false;
            }
            setDraft(undefined);
            reloadThreads();
            return true;
          }}
        />
      );
    },
    [reloadThreads, toasts]
  );

  const reportedError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== 'error' || state.error == null) return;
    if (reportedError.current === state.error) return;
    reportedError.current = state.error;
    toasts.push(state.error, { label: 'Open on GitHub', href: filesUrl(pr) });
  }, [state.phase, state.error, toasts, pr]);

  // The two revisions a binary file is compared across. Without the base there
  // is nothing to compare against, so the viewer shows the new file alone
  // rather than the same image twice under two headings.
  const refs = useMemo<FileRefs | undefined>(
    () =>
      page.headSha == null ? undefined : { owner: pr.owner, repo: pr.repo, baseSha, headSha: page.headSha },
    [baseSha, page.headSha, pr.owner, pr.repo]
  );

  const loadDiffFiles = useMemo(
    () => (page.headSha == null ? undefined : createFileLoader(pr, page.headSha)),
    [page.headSha, pr]
  );

  // An open eye means still to read, a closed one means done. A button rather
  // than a tick box, so space works on it the same way and reviewing a pull
  // request is space, read, space.
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
    [markViewed, viewed]
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
              void copyPath(path).then((copied) => {
                toasts.push(copied ? 'Path copied.' : 'The clipboard is blocked here.');
              });
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
    [refs, toasts]
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
      enableGutterUtility: true,
      onGutterUtilityClick(range: { start: number; side?: string }, context: { item: CodeViewItem<ReviewThread> }) {
        const item = context.item;
        if (item.type !== 'diff') return;
        setDraft({
          id: 'draft',
          path: item.fileDiff.name,
          line: range.start,
          side: range.side === 'deletions' ? 'deletions' : 'additions',
          isResolved: false,
          isOutdated: false,
          isDraft: true,
          comments: [],
        });
      },
      unsafeCSS: `${HEADER_CSS}\n${SEPARATOR_CSS}`,
      loadDiffFiles,
    }),
    [diffStyle, themeChoice, page.themeType, page.lightTheme, page.darkTheme, loadDiffFiles]
  );

  const toggleLayout = useCallback(() => {
    setDiffStyle((previous) => {
      const next = previous === 'split' ? 'unified' : 'split';
      writeSetting('layout', next);
      return next;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      writeSetting('sidebar', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  const themeType = themeChoice ?? page.themeType;
  const themeName = themeType === 'dark' ? page.darkTheme : page.lightTheme;
  const surfaces = useThemeSurfaces(themeName);

  const toggleTheme = useCallback(() => {
    setThemeChoice((current) => {
      const next = (current ?? page.themeType) === 'dark' ? 'light' : 'dark';
      writeSetting('theme', next);
      return next;
    });
  }, [page.themeType]);
  const { stats } = state;

  return (
    <div className="dh-overlay" data-theme={themeType} style={surfaces.overlay}>
      <header className="dh-header">
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="sidebar"
            onClick={toggleSidebar}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Hide the file tree' : 'Show the file tree'}
        >
          <IconSidebarLeft size={16} />
        </button>
        <div className="dh-identity">
          {page.author != null && (
            <a
              className="dh-author"
              href={`${GITHUB_ORIGIN}/${page.author}`}
              target="_top"
              title={`Opened by ${page.author} — open their profile`}
            >
              <img src={`${GITHUB_ORIGIN}/${page.author}.png?size=64`} alt={`Opened by ${page.author}`} />
            </a>
          )}
          <strong>
            {pr.owner}/{pr.repo} #{pr.number}
          </strong>
          <span className="dh-title">{page.title}</span>
        </div>
        <div className="dh-stats">
          <span>
            {viewedOnShow.toLocaleString()} / {stats.fileCount.toLocaleString()} viewed
          </span>
          <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
          <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
          {state.phase === 'loading' && <span className="dh-loading">loading…</span>}
        </div>
        <div className="dh-actions">
          <button
            type="button"
            className="dh-primary"
            data-dh-action="review"
            onClick={() => setReviewOpen(true)}
            title="Finish your review"
          >
            <IconCheck size={15} />
            Finish review
          </button>
          <span className="dh-actions-divider" aria-hidden="true" />
          <button
            type="button"
            className="dh-icon-button"
            data-dh-action="whitespace"
            aria-pressed={ignoreWhitespace}
            onClick={() =>
              setIgnoreWhitespace((on) => {
                writeSetting('whitespace', on ? 'show' : 'ignore');
                return !on;
              })
            }
            title={
              ignoreWhitespace
                ? 'Ignoring files that changed only in spacing — click to show them'
                : 'Hide files that changed only in spacing'
            }
          >
            <IconParagraph size={16} />
          </button>
          <button
            type="button"
            className="dh-icon-button"
            data-dh-action="layout"
            onClick={toggleLayout}
            title={diffStyle === 'split' ? 'Split view — switch to unified' : 'Unified view — switch to split'}
          >
            {diffStyle === 'split' ? <IconDiffSplit size={16} /> : <IconDiffUnified size={16} />}
          </button>
          <button
            type="button"
            className="dh-icon-button"
            data-dh-action="theme"
            onClick={toggleTheme}
            title={themeType === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {themeType === 'dark' ? <IconColorLight size={16} /> : <IconColorDark size={16} />}
          </button>
          <button
            type="button"
            className="dh-icon-button"
            data-dh-action="help"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <IconQuestion size={16} />
          </button>
          <a
            className="dh-icon-button"
            data-dh-action="github"
            href={filesUrl(pr)}
            target="_top"
            title="Open GitHub's own Files changed view"
          >
            <IconBrandGithub size={16} />
          </a>
          <button
            type="button"
            className="dh-icon-button"
            data-dh-action="close"
            onClick={closeViewer}
            title="Close (Esc)"
          >
            <IconX size={16} />
          </button>
        </div>
      </header>

      <div className="dh-body">
        <aside className="dh-sidebar" hidden={!sidebarOpen} style={{ width: sidebarWidth }}>
          <div className="dh-filters">
            <label className="dh-field">
              <span>files to include</span>
              <input
                value={includeInput}
                placeholder="e.g. src/**"
                onChange={(event) => setIncludeInput(event.target.value)}
                spellCheck={false}
              />
            </label>
            {state.includeError != null && <p className="dh-pattern-error">{state.includeError}</p>}
            <label className="dh-field">
              <span>files to exclude</span>
              <input
                value={excludeInput}
                placeholder="e.g. *.test.*, *.snap"
                onChange={(event) => setExcludeInput(event.target.value)}
                spellCheck={false}
              />
            </label>
            {state.excludeError != null && <p className="dh-pattern-error">{state.excludeError}</p>}
            {state.hiddenCount > 0 && (
              <p className="dh-hidden">{state.hiddenCount.toLocaleString()} files hidden</p>
            )}
            {state.spacingOnlyCount > 0 && (
              <p className="dh-hidden">
                {state.spacingOnlyCount.toLocaleString()} changed only in spacing
              </p>
            )}
          </div>
          <FileTree className="dh-tree" model={model} style={{ ...surfaces.tree, ...TREE_STYLE }} />
          <DiffStatsPanel stats={stats} />
        </aside>
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
          items={itemsWithThreads}
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
            // Jump to the first file still to be read.
            const next = visibleRef.current.find((file) => !viewed.has(file.item.id));
            if (next == null) return;
            viewerRef.current?.scrollTo({ type: 'item', id: next.item.id, align: 'start', behavior: 'smooth' });
          }}
          onClose={() => setReviewOpen(false)}
          onSubmit={async (verdict, body) => {
            const result = await ask('review', { event: verdict, body });
            if (!result.ok) return result.error ?? 'GitHub refused the review.';
            toasts.push('Review submitted.');
            reloadThreads();
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
