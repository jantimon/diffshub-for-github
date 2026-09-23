import { useCallback, useEffect, useRef } from 'react';

import { appendFile, createAccumulator, sumStats, type PatchAccumulator } from '@/patch/accumulator';
import type { FileFilter } from '@/patch/filters';
import { streamPatchFiles } from '@/patch/stream';
import { describeError } from '@/shared/errors';
import { cachedGithubFetch } from '@/viewer/net/cachedGithubFetch';
import type { Session } from '@/viewer/state/session';

/** Publish cadence, mirroring what diffshub.com settled on */
const WORK_BUDGET_MS = 8;
const PUBLISH_INTERVAL_MS = 100;
const PUBLISH_FILE_COUNT = 25;

interface Options {
  session: Session;
  url: string;
  /**
   * The commit this patch belongs to, which is what a kept copy is keyed on.
   * `docs/caching.md` says what that buys and what it rules out
   */
  sha: string | undefined;
  /** Prefix for each file's cache key in the diff library, which has to name the commit */
  cacheKeyPrefix: string;
  filter: FileFilter;
  ignoreWhitespace: boolean;
}

/**
 * Streams the patch into the session, parsing it a file at a time as it
 * arrives, and publishes which files are on show.
 *
 * Parsing yields to the browser every few milliseconds and publishes in
 * batches, so the first files are readable long before the download ends. The
 * whole patch stays parsed in memory, so a filter change is a recalculation
 * rather than another download.
 */
export function usePatchLoader({
  session,
  url,
  sha,
  cacheKeyPrefix,
  filter,
  ignoreWhitespace,
}: Options): void {
  const accumulatorRef = useRef<PatchAccumulator>(createAccumulator());
  // The streaming effect reads these, so a filter change does not restart it
  const filterRef = useRef(filter);
  const ignoreWhitespaceRef = useRef(ignoreWhitespace);

  const publish = useCallback(() => {
    const { files } = accumulatorRef.current;
    const { isVisible, includeError, excludeError } = filterRef.current;
    const matching = files.filter((file) => isVisible(file.path));
    const visible = ignoreWhitespaceRef.current ? matching.filter((file) => !file.spacingOnly) : matching;
    session.set({
      all: [...files],
      visible,
      pathToItemId: new Map(visible.map((file) => [file.path, file.item.id])),
      stats: sumStats(visible),
      hiddenCount: files.length - matching.length,
      spacingOnlyCount: matching.length - visible.length,
      includeError,
      excludeError,
    });
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    // A fresh accumulator, published at once, clears the list, the tree and
    // the counts together, so nothing from a previous patch stays on show
    accumulatorRef.current = createAccumulator();
    session.set({ phase: 'loading', error: undefined });
    publish();

    let sincePublish = 0;
    let lastPublishedAt = 0;

    const run = async (): Promise<void> => {
      const response = await cachedGithubFetch(url, { sha, signal: controller.signal });
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
            publish();
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

      /**
       * A run that was given up on says nothing about the one that replaced it.
       *
       * Reading a kept copy never throws when it is abandoned -- the stream just
       * stops being pulled -- so unlike a download this reaches the end with the
       * signal already aborted, and would mark the newer commit's download ready
       * before a byte of it had arrived.
       */
      if (controller.signal.aborted) return;

      publish();
      session.set({ phase: 'ready' });
    };

    run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      session.set({ phase: 'error', error: describeError(error) });
    });

    return () => controller.abort();
  }, [url, sha, cacheKeyPrefix, publish, session]);

  // A filter change only changes which of the parsed files are on show
  useEffect(() => {
    if (filterRef.current === filter && ignoreWhitespaceRef.current === ignoreWhitespace) return;
    filterRef.current = filter;
    ignoreWhitespaceRef.current = ignoreWhitespace;
    publish();
  }, [filter, ignoreWhitespace, publish]);
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield != null) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
