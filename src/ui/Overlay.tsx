import { DEFAULT_THEMES, type CodeViewItem } from '@pierre/diffs';
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewReactOptions,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { filesUrl, patchUrl, type PullRequestRef } from '@/github/pr';
import { usePatchStream } from '@/patch/usePatchStream';
import { closeViewer, usePageInfo } from './usePageInfo';
import { readSetting, writeSetting } from './storage';

const POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 1) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
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
  const viewerRef = useRef<CodeViewHandle<undefined, undefined> | null>(null);
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(() =>
    readSetting('layout', 'split') === 'unified' ? 'unified' : 'split'
  );
  const [excludeInput, setExcludeInput] = useState(() => readSetting('excludes', ''));
  const [excludePatterns, setExcludePatterns] = useState(excludeInput);

  // Re-reading the patch is the price of filtering in the accumulator, so wait
  // until typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setExcludePatterns(excludeInput);
      writeSetting('excludes', excludeInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [excludeInput]);

  const stateRef = useRef<{ pathToItemId: ReadonlyMap<string, string> }>({ pathToItemId: new Map() });

  const onSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    if (selectedPaths.length !== 1) return;
    const itemId = stateRef.current.pathToItemId.get(selectedPaths[0]);
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

  const state = usePatchStream({
    url: patchUrl(pr),
    cacheKeyPrefix: `${pr.owner}/${pr.repo}/${pr.number}`,
    excludePatterns,
    viewerRef,
    model,
  });
  stateRef.current = state;

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
    }),
    [diffStyle, page.themeType, page.lightTheme, page.darkTheme]
  );

  const toggleLayout = useCallback(() => {
    setDiffStyle((previous) => {
      const next = previous === 'split' ? 'unified' : 'split';
      writeSetting('layout', next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeViewer();
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
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
          <a href={filesUrl(pr)} target="_top" title="Open GitHub's own Files changed view">
            GitHub
          </a>
          <button type="button" onClick={closeViewer} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>

      {state.phase === 'error' && (
        <div className="dh-error" role="alert">
          {state.error} <a href={filesUrl(pr)} target="_top">Open on GitHub</a>
        </div>
      )}

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
        </aside>
        <CodeView<undefined, undefined>
          ref={viewerRef}
          className="dh-code"
          initialItems={NO_ITEMS}
          options={options}
        />
      </div>
    </div>
  );
}
