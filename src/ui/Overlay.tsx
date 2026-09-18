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
  IconDiffSplit,
  IconDiffUnified,
  IconEye,
  IconEyeSlash,
  IconQuestion,
  IconSidebarLeft,
  IconX,
} from '@pierre/icons';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { createFileLoader } from '@/github/fileLoader';
import { blameUrl, blobUrl, copyPath, type FileRefs } from '@/github/fileLinks';
import { filesUrl, patchUrl, type PullRequestRef } from '@/github/pr';
import type { DiffStats } from '@/patch/accumulator';
import { usePatchStream } from '@/patch/usePatchStream';
import { BinaryCompare, isImagePath } from './BinaryCompare';
import { ShortcutHelp } from './ShortcutHelp';
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
} as CSSProperties;

const TREE_CSS = `
[data-file-tree-search-container] {
  padding-inline: 0;
  margin-right: 0;
}
[data-file-tree-virtualized-scroll='true'] {
  padding-inline-start: 0;
}
`;

const HEADER_CSS = `
[data-prev-name],
[data-rename-icon] {
  color: #d29922;
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
  const viewerRef = useRef<CodeViewHandle<undefined, undefined> | null>(null);

  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(() =>
    readSetting('layout', 'split') === 'unified' ? 'unified' : 'split'
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => readSetting('sidebar', 'open') !== 'closed');
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
  });
  const search = useFileTreeSearch(model);

  const { state, items, visibleRef } = usePatchStream({
    url: patchUrl(pr),
    cacheKeyPrefix: `${pr.owner}/${pr.repo}/${pr.number}`,
    include,
    exclude,
    model,
  });
  pathToItemIdRef.current = state.pathToItemId;

  const navigation = useNavigation(viewerRef, visibleRef);
  const { viewed, toggle } = useViewed(`${pr.owner}/${pr.repo}/${pr.number}/${page.headSha ?? 'head'}`);

  // Ticking a file off moves to the next one and puts the keyboard on its tick
  // box, so the whole review is space, read, space.
  const markViewed = useCallback(
    (id: string) => {
      toggle(id);
      const files = visibleRef.current;
      const next = files[files.findIndex((file) => file.item.id === id) + 1];
      if (next == null) return;
      viewerRef.current?.scrollTo({ type: 'item', id: next.item.id, align: 'start', behavior: 'smooth' });
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-dh-viewed="${CSS.escape(next.item.id)}"]`)?.focus();
      }, 350);
    },
    [toggle, visibleRef]
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

  const reportedError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== 'error' || state.error == null) return;
    if (reportedError.current === state.error) return;
    reportedError.current = state.error;
    toasts.push(state.error, { label: 'Open on GitHub', href: filesUrl(pr) });
  }, [state.phase, state.error, toasts, pr]);

  const refs = useMemo<FileRefs | undefined>(
    () =>
      page.headSha == null
        ? undefined
        : { owner: pr.owner, repo: pr.repo, baseSha: page.headSha, headSha: page.headSha },
    [page.headSha, pr.owner, pr.repo]
  );

  const loadDiffFiles = useMemo(
    () => (page.headSha == null ? undefined : createFileLoader(pr, page.headSha)),
    [page.headSha, pr]
  );

  // An open eye means still to read, a closed one means done. A button rather
  // than a tick box, so space works on it the same way and reviewing a pull
  // request is space, read, space.
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<undefined>) => {
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
    (item: CodeViewItem<undefined>) => {
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

  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      layout: { paddingTop: 0, gap: 1, paddingBottom: 0 },
      diffStyle,
      themeType: page.themeType,
      theme: { light: page.lightTheme, dark: page.darkTheme },
      stickyHeaders: true,
      overflow: 'scroll',
      lineHoverHighlight: 'number',
      enableLineSelection: true,
      unsafeCSS: HEADER_CSS,
      loadDiffFiles,
    }),
    [diffStyle, page.themeType, page.lightTheme, page.darkTheme, loadDiffFiles]
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

  const themeName = page.themeType === 'dark' ? page.darkTheme : page.lightTheme;
  const surfaces = useThemeSurfaces(themeName);
  const { stats } = state;

  return (
    <div className="dh-overlay" data-theme={page.themeType} style={surfaces.overlay}>
      <header className="dh-header">
        <button
          type="button"
          className="dh-icon-button"
          onClick={toggleSidebar}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Hide the file tree' : 'Show the file tree'}
        >
          <IconSidebarLeft size={16} />
        </button>
        <div className="dh-identity">
          <strong>
            {pr.owner}/{pr.repo} #{pr.number}
          </strong>
          <span className="dh-title">{page.title}</span>
        </div>
        <div className="dh-stats">
          <span>
            {viewed.size.toLocaleString()} / {stats.fileCount.toLocaleString()} viewed
          </span>
          <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
          <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
          {state.phase === 'loading' && <span className="dh-loading">loading…</span>}
        </div>
        <div className="dh-actions">
          <button
            type="button"
            className="dh-icon-button"
            onClick={toggleLayout}
            title={diffStyle === 'split' ? 'Split view — switch to unified' : 'Unified view — switch to split'}
          >
            {diffStyle === 'split' ? <IconDiffSplit size={16} /> : <IconDiffUnified size={16} />}
          </button>
          <button
            type="button"
            className="dh-icon-button"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <IconQuestion size={16} />
          </button>
          <a
            className="dh-icon-button"
            href={filesUrl(pr)}
            target="_top"
            title="Open GitHub's own Files changed view"
          >
            <IconBrandGithub size={16} />
          </a>
          <button type="button" className="dh-icon-button" onClick={closeViewer} title="Close (Esc)">
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
        <CodeView<undefined, undefined>
          ref={viewerRef}
          className="dh-code"
          items={items}
          options={options}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderMetadata={renderHeaderMetadata}
        />
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {comparing != null && refs != null && (
        <BinaryCompare refs={refs} path={comparing} onClose={() => setComparing(undefined)} />
      )}
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
