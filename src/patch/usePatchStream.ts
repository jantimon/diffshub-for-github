import type { CodeViewItem } from '@pierre/diffs';
import type { FileTree } from '@pierre/trees';

import type { ReviewThread } from '@/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { compileFilters } from './filters';
import { streamPatchFiles } from './stream';
import {
  appendFile,
  createAccumulator,
  sumStats,
  type DiffStats,
  type ParsedFile,
  type PatchAccumulator,
} from './accumulator';
import { githubFetch } from '@/github/githubFetch';

/** Publish cadence, mirroring what diffshub.com settled on. */
const WORK_BUDGET_MS = 8;
const PUBLISH_INTERVAL_MS = 100;
const PUBLISH_FILE_COUNT = 25;

export interface PatchStreamState {
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  stats: DiffStats;
  hiddenCount: number;
  includeError?: string;
  excludeError?: string;
  pathToItemId: ReadonlyMap<string, string>;
}

export interface PatchStream {
  state: PatchStreamState;
  /** The files a filter lets through, in patch order. */
  items: readonly CodeViewItem<ReviewThread>[];
  visibleRef: { current: readonly ParsedFile[] };
  /** Updated as files are published, ahead of the React commit. */
  pathToItemIdRef: { current: ReadonlyMap<string, string> };
}

interface Options {
  url: string;
  cacheKeyPrefix: string;
  include: string;
  exclude: string;
  model: FileTree;
}

const EMPTY_STATS: DiffStats = { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 };

export function usePatchStream({ url, cacheKeyPrefix, include, exclude, model }: Options): PatchStream {
  const [items, setItems] = useState<readonly CodeViewItem<ReviewThread>[]>([]);
  const [state, setState] = useState<PatchStreamState>({
    phase: 'loading',
    stats: EMPTY_STATS,
    hiddenCount: 0,
    pathToItemId: new Map(),
  });

  const accumulatorRef = useRef<PatchAccumulator>(createAccumulator());
  const visibleRef = useRef<readonly ParsedFile[]>([]);
  const pathToItemIdRef = useRef<ReadonlyMap<string, string>>(new Map());
  const filter = useMemo(() => compileFilters(include, exclude), [include, exclude]);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // The whole patch stays parsed in memory, so changing a filter is a
  // recalculation rather than another 20 MB download.
  const publish = useCallback(
    (resetTree: boolean) => {
      const accumulator = accumulatorRef.current;
      const { isVisible } = filterRef.current;
      const previous = visibleRef.current;
      const visible = accumulator.files.filter((file) => isVisible(file.path));
      visibleRef.current = visible;

      setItems(visible.map((file) => file.item));

      if (resetTree || visible.length < previous.length) {
        model.resetPaths(visible.map((file) => file.path));
        model.setGitStatus(visible.flatMap((file) => (file.status == null ? [] : [{ path: file.path, status: file.status }])));
      } else {
        const added = visible.slice(previous.length);
        if (added.length > 0) {
          model.batch(added.map((file) => ({ type: 'add' as const, path: file.path })));
          const statuses = added.flatMap((file) =>
            file.status == null ? [] : [{ path: file.path, status: file.status }]
          );
          if (statuses.length > 0) model.applyGitStatusPatch({ set: statuses });
        }
      }

      const pathToItemId = new Map(visible.map((file) => [file.path, file.item.id]));
      pathToItemIdRef.current = pathToItemId;
      setState((current) => ({
        ...current,
        stats: sumStats(visible),
        hiddenCount: accumulator.files.length - visible.length,
        includeError: filterRef.current.includeError,
        excludeError: filterRef.current.excludeError,
        pathToItemId,
      }));
    },
    [model]
  );

  useEffect(() => {
    const controller = new AbortController();
    accumulatorRef.current = createAccumulator();
    visibleRef.current = [];
    model.resetPaths([]);
    model.setGitStatus([]);
    setItems([]);

    let sincePublish = 0;
    let lastPublishedAt = 0;

    const run = async (): Promise<void> => {
      const response = await githubFetch(url, controller.signal);
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for this patch.`);
      if (response.body == null) throw new Error('GitHub returned no patch body.');

      let turnStartedAt = performance.now();
      await streamPatchFiles(
        response.body,
        async (fileText) => {
          appendFile(accumulatorRef.current, fileText, cacheKeyPrefix);
          sincePublish += 1;

          const now = performance.now();
          if (sincePublish >= PUBLISH_FILE_COUNT || now - lastPublishedAt >= PUBLISH_INTERVAL_MS) {
            publish(false);
            sincePublish = 0;
            lastPublishedAt = now;
          }
          if (now - turnStartedAt >= WORK_BUDGET_MS) {
            await yieldToBrowser();
            turnStartedAt = performance.now();
          }
        },
        controller.signal
      );

      publish(false);
      setState((current) => ({ ...current, phase: 'ready' }));
    };

    run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    });

    return () => controller.abort();
  }, [url, cacheKeyPrefix, model, publish]);

  // A filter change only changes which of the parsed files are on show.
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    publish(true);
  }, [filter, publish]);

  return { state, items, visibleRef, pathToItemIdRef };
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield != null) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
