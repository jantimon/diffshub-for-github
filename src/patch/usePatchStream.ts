import type { CodeViewHandle } from '@pierre/diffs/react';
import type { FileTree } from '@pierre/trees';
import { useEffect, useRef, useState } from 'react';

import { compileExcludes } from './exclude';
import { streamPatchFiles } from './stream';
import {
  appendFile,
  createAccumulator,
  takePendingItems,
  takePendingPaths,
  type DiffStats,
  type PatchAccumulator,
} from './accumulator';

/** Publish cadence, mirroring what diffshub.com settled on. */
const WORK_BUDGET_MS = 8;
const PUBLISH_INTERVAL_MS = 100;
const PUBLISH_FILE_COUNT = 25;

export interface PatchStreamState {
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  stats: DiffStats;
  hiddenCount: number;
  patternError?: string;
  /** Maps a tree path back to the viewer item it came from. */
  pathToItemId: ReadonlyMap<string, string>;
}

interface Options {
  url: string;
  cacheKeyPrefix: string;
  excludePatterns: string;
  viewerRef: { current: CodeViewHandle<undefined, undefined> | null };
  model: FileTree;
}

const EMPTY_STATS: DiffStats = { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 };

export interface PatchStream {
  state: PatchStreamState;
  /** The files parsed so far, for navigation and per-file actions. */
  accumulatorRef: { current: PatchAccumulator };
}

export function usePatchStream({
  url,
  cacheKeyPrefix,
  excludePatterns,
  viewerRef,
  model,
}: Options): PatchStream {
  const [state, setState] = useState<PatchStreamState>({
    phase: 'loading',
    stats: EMPTY_STATS,
    hiddenCount: 0,
    pathToItemId: new Map(),
  });
  const accumulatorRef = useRef<PatchAccumulator>(createAccumulator());

  useEffect(() => {
    const controller = new AbortController();
    const { isExcluded, error: patternError } = compileExcludes(excludePatterns);
    const accumulator = createAccumulator();
    accumulatorRef.current = accumulator;

    // A filter change re-reads the patch so excluded files never reach the tree
    // or the viewer. The response comes from the HTTP cache, not the network.
    model.resetPaths([]);
    model.setGitStatus([]);

    let publishedStatuses = 0;
    let lastPublishedAt = 0;
    let sincePublish = 0;

    const publish = (): void => {
      const items = takePendingItems(accumulator);
      if (items.length > 0) viewerRef.current?.addItems(items);

      const paths = takePendingPaths(accumulator);
      if (paths.length > 0) {
        model.batch(paths.map((path) => ({ type: 'add' as const, path })));
        const statuses = accumulator.gitStatus.slice(publishedStatuses);
        publishedStatuses = accumulator.gitStatus.length;
        if (statuses.length > 0) model.applyGitStatusPatch({ set: statuses });
      }

      lastPublishedAt = performance.now();
      sincePublish = 0;
      setState((previous) => ({
        ...previous,
        stats: { ...accumulator.stats },
        hiddenCount: accumulator.hiddenCount,
        pathToItemId: accumulator.pathToItemId,
        patternError,
      }));
    };

    const run = async (): Promise<void> => {
      const response = await fetch(url, { credentials: 'include', signal: controller.signal });
      if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} for this patch.`);
      }
      if (response.body == null) {
        throw new Error('GitHub returned no patch body.');
      }

      let turnStartedAt = performance.now();
      await streamPatchFiles(
        response.body,
        async (fileText) => {
          appendFile(accumulator, fileText, cacheKeyPrefix, isExcluded);
          sincePublish += 1;

          const now = performance.now();
          if (sincePublish >= PUBLISH_FILE_COUNT || now - lastPublishedAt >= PUBLISH_INTERVAL_MS) {
            publish();
          }
          if (now - turnStartedAt >= WORK_BUDGET_MS) {
            await yieldToBrowser();
            turnStartedAt = performance.now();
          }
        },
        controller.signal
      );

      publish();
      setState((previous) => ({ ...previous, phase: 'ready' }));
    };

    run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    });

    return () => controller.abort();
  }, [url, cacheKeyPrefix, excludePatterns, model, viewerRef]);

  return { state, accumulatorRef };
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield != null) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
