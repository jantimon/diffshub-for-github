import { DEFAULT_THEMES, type CodeViewItem } from '@pierre/diffs';
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewReactOptions,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import { FileTree, useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createFileLoader } from '@/github/fileLoader';
import { blameUrl, blobUrl, copyPath, type FileRefs } from '@/github/fileLinks';
import { filesUrl, patchUrl, type PullRequestRef } from '@/github/pr';
import { usePatchStream } from '@/patch/usePatchStream';
import { BinaryCompare, isImagePath } from './BinaryCompare';
import { ShortcutHelp } from './ShortcutHelp';
import { ToastStack, useToasts } from './Toast';
import { closeViewer, usePageInfo } from './usePageInfo';
import { useNavigation } from './useNavigation';
import { useShortcuts } from './useShortcuts';
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

const NO_ITEMS: readonly CodeViewItem<undefined>[] = [];

export function Overlay({ pr }: { pr: PullRequestRef }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <Viewer pr={pr} />
    </WorkerPoolContextProvider>
  );
}

function Viewer({ pr }: { pr: PullRequestRef }) {
  const page = usePageInfo();
  const toasts = useToasts();
  const viewerRef = useRef<CodeViewHandle<undefined, undefined> | null>(null);
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(() =>
    readSetting('layout', 'split') === 'unified' ? 'unified' : 'split'
  );
  const [excludeInput, setExcludeInput] = useState(() => readSetting('excludes', ''));
  const [excludePatterns, setExcludePatterns] = useState(excludeInput);
  const [helpOpen, setHelpOpen] = useState(false);
  const [comparing, setComparing] = useState<string | undefined>(undefined);

  // Re-reading the patch is the price of filtering in the accumulator, so wait
  // until typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setExcludePatterns(excludeInput);
      writeSetting('excludes', excludeInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [excludeInput]);

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
    onSelectionChange,
  });
  const search = useFileTreeSearch(model);

  const { state, accumulatorRef } = usePatchStream({
    url: patchUrl(pr),
    cacheKeyPrefix: `${pr.owner}/${pr.repo}/${pr.number}`,
    excludePatterns,
    viewerRef,
    model,
  });
  pathToItemIdRef.current = state.pathToItemId;

  const navigation = useNavigation(viewerRef, accumulatorRef);

  useShortcuts({
    ...navigation,
    focusFilter: useCallback(() => search.open(), [search]),
    toggleHelp: useCallback(() => setHelpOpen((open) => !open), []),
    close: closeViewer,
  });

  // A fetch that never got off the ground deserves a reason, not an empty view.
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

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<undefined>) => {
      if (refs == null || item.type !== 'diff') return null;
      const path = item.fileDiff.name;
      const isBinary = item.fileDiff.hunks.length === 0;
      return (
        <span className="dh-file-links">
          {isBinary && isImagePath(path) && (
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
          <a href={blobUrl(refs, path, 'head')} target="_top">
            File
          </a>
          <a href={blameUrl(refs, path)} target="_top">
            Blame
          </a>
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

  const { stats } = state;

  return (
    <div className="dh-overlay" data-theme={page.themeType}>
      <header className="dh-header">
        <div className="dh-identity">
          <strong>
            {pr.owner}/{pr.repo} #{pr.number}
          </strong>
          <span className="dh-title">{page.title}</span>
        </div>
        <div className="dh-stats">
          <span>{stats.fileCount.toLocaleString()} files</span>
          <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
          <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
          {state.phase === 'loading' && <span className="dh-loading">loading…</span>}
        </div>
        <div className="dh-actions">
          <button type="button" onClick={toggleLayout} title="Toggle split and unified">
            {diffStyle === 'split' ? 'Split' : 'Unified'}
          </button>
          <button type="button" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            ?
          </button>
          <a href={filesUrl(pr)} target="_top" title="Open GitHub's own Files changed view">
            GitHub
          </a>
          <button type="button" onClick={closeViewer} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>

      <div className="dh-body">
        <aside className="dh-sidebar">
          <input
            className="dh-exclude"
            value={excludeInput}
            placeholder="exclude e.g. **/*.test.*"
            onChange={(event) => setExcludeInput(event.target.value)}
            spellCheck={false}
          />
          {state.patternError != null && <p className="dh-pattern-error">{state.patternError}</p>}
          {state.hiddenCount > 0 && (
            <p className="dh-hidden">{state.hiddenCount.toLocaleString()} files hidden</p>
          )}
          <FileTree className="dh-tree" model={model} />
          <dl className="dh-diffstats">
            <dt>Files</dt>
            <dd>{stats.fileCount.toLocaleString()}</dd>
            <dt>Additions</dt>
            <dd>{stats.addedLines.toLocaleString()}</dd>
            <dt>Deletions</dt>
            <dd>{stats.deletedLines.toLocaleString()}</dd>
            <dt>Lines</dt>
            <dd>{stats.totalLines.toLocaleString()}</dd>
          </dl>
        </aside>
        <CodeView<undefined, undefined>
          ref={viewerRef}
          className="dh-code"
          initialItems={NO_ITEMS}
          options={options}
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
