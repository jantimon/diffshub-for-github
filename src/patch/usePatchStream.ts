import type { CodeViewItem } from '@pierre/diffs';
import type { FileTree } from '@pierre/trees';

import type { ReviewThread } from '@/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { githubFetch } from '@/viewer/files/githubFetch';
import { compileFilters, type MatchOptions } from './filters';
import { streamPatchFiles } from './stream';
import {
  appendFile,
  createAccumulator,
  sumStats,
  type DiffStats,
  type ParsedFile,
  type PatchAccumulator,
} from './accumulator';

/** Publish cadence, mirroring what diffshub.com settled on */
const WORK_BUDGET_MS = 8;
const PUBLISH_INTERVAL_MS = 100;
const PUBLISH_FILE_COUNT = 25;

export interface PatchStreamState {
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  stats: DiffStats;
  hiddenCount: number;
  /** Files held back because nothing in them changed but spacing */
  spacingOnlyCount: number;
  includeError?: string;
  excludeError?: string;
  pathToItemId: ReadonlyMap<string, string>;
}

export interface PatchStream {
  /** Phase, counts and filter errors. A change here redraws the viewer */
  state: PatchStreamState;
  /** The files a filter lets through, in patch order */
  items: readonly CodeViewItem<ReviewThread>[];
  /** The same files for the key handlers, which need the current list without a redraw */
  visibleRef: { current: readonly ParsedFile[] };
  /** Updated as files are published, ahead of the React commit */
}

interface Options {
  url: string;
  cacheKeyPrefix: string;
  include: string;
  exclude: string;
  includeOptions: MatchOptions;
  excludeOptions: MatchOptions;
  ignoreWhitespace: boolean;
  model: FileTree;
  /** Filled in as files are published, and read by the tree to draw its ticks */
  pathToItemIdRef: { current: ReadonlyMap<string, string> };
}

const EMPTY_STATS: DiffStats = { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 };

export function usePatchStream({
  url,
  cacheKeyPrefix,
  include,
  exclude,
  includeOptions,
  excludeOptions,
  ignoreWhitespace,
  model,
  pathToItemIdRef,
}: Options): PatchStream {
  const [items, setItems] = useState<readonly CodeViewItem<ReviewThread>[]>([]);
  const [state, setState] = useState<PatchStreamState>({
    phase: 'loading',
    stats: EMPTY_STATS,
    hiddenCount: 0,
    spacingOnlyCount: 0,
    pathToItemId: new Map(),
  });

  const accumulatorRef = useRef<PatchAccumulator>(createAccumulator());
  const visibleRef = useRef<readonly ParsedFile[]>([]);
  const filter = useMemo(
    () => compileFilters(include, exclude, { include: includeOptions, exclude: excludeOptions }),
    [include, exclude, includeOptions, excludeOptions],
  );
  const filterRef = useRef(filter);
  const ignoreWhitespaceRef = useRef(ignoreWhitespace);

  // The whole patch stays parsed in memory, so changing a filter is a
  // recalculation rather than another 20 MB download
  const publish = useCallback(
    (resetTree: boolean) => {
      const accumulator = accumulatorRef.current;
      const { isVisible } = filterRef.current;
      const previous = visibleRef.current;
      const hideSpacing = ignoreWhitespaceRef.current;

      const matching = accumulator.files.filter((file) => isVisible(file.path));
      const visible = hideSpacing ? matching.filter((file) => !file.spacingOnly) : matching;
      visibleRef.current = visible;

      setItems(visible.map((file) => file.item));

      /**
       * The tree renders rows inside the model calls below, and every row looks
       * its file up by path to decide whether to draw a tick. The map has to be
       * current first, or a file that has just become visible is drawn against
       * the previous one and shows no tick until something else redraws it.
       */
      const pathToItemId = new Map(visible.map((file) => [file.path, file.item.id]));
      pathToItemIdRef.current = pathToItemId;

      if (resetTree || visible.length < previous.length) {
        model.resetPaths(visible.map((file) => file.path));
        model.setGitStatus(
          visible.flatMap((file) => (file.status == null ? [] : [{ path: file.path, status: file.status }])),
        );
      } else {
        const added = visible.slice(previous.length);
        if (added.length > 0) {
          model.batch(added.map((file) => ({ type: 'add' as const, path: file.path })));
          const statuses = added.flatMap((file) =>
            file.status == null ? [] : [{ path: file.path, status: file.status }],
          );
          if (statuses.length > 0) model.applyGitStatusPatch({ set: statuses });
        }
      }

      setState((current) => ({
        ...current,
        stats: sumStats(visible),
        hiddenCount: accumulator.files.length - matching.length,
        spacingOnlyCount: matching.length - visible.length,
        includeError: filterRef.current.includeError,
        excludeError: filterRef.current.excludeError,
        pathToItemId,
      }));
    },
    [model, pathToItemIdRef],
  );

  useEffect(() => {
    const controller = new AbortController();
    // Publishing the fresh accumulator clears the list, the tree and the
    // counts together, so nothing from the previous patch is left on show
    accumulatorRef.current = createAccumulator();
    publish(true);

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
        controller.signal,
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
  }, [url, cacheKeyPrefix, publish]);

  // A filter change only changes which of the parsed files are on show. The
  // refs carry the choice into publish: the streaming effect depends on
  // publish, so rebuilding it would start the download again
  const firstFilter = useRef(true);
  useEffect(() => {
    filterRef.current = filter;
    ignoreWhitespaceRef.current = ignoreWhitespace;
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    publish(true);
  }, [filter, ignoreWhitespace, publish]);

  return { state, items, visibleRef };
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield != null) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
