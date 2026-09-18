import type { CodeViewHandle } from '@pierre/diffs/react';

import type { ReviewThread } from '@/bridge';
import { useCallback } from 'react';

import type { ParsedFile } from '@/patch/accumulator';

/**
 * Walks the diff file by file and hunk by hunk.
 *
 * Where you are is read from what the viewer has on screen rather than from a
 * counter, so scrolling by hand and then pressing a key carries on from what
 * you are actually looking at.
 */
export function useNavigation(
  viewerRef: { current: CodeViewHandle<ReviewThread, undefined> | null },
  visibleRef: { current: readonly ParsedFile[] }
) {
  const currentIndex = useCallback((): number => {
    const files = visibleRef.current;
    const rendered = viewerRef.current?.getInstance()?.getRenderedItems() ?? [];

    let topId: string | undefined;
    let topEdge = Number.POSITIVE_INFINITY;
    for (const entry of rendered) {
      const { bottom, top } = entry.element.getBoundingClientRect();
      if (bottom <= 0) continue;
      if (top < topEdge) {
        topEdge = top;
        topId = entry.id;
      }
    }

    if (topId == null) return 0;
    const index = files.findIndex((file) => file.item.id === topId);
    return index < 0 ? 0 : index;
  }, [viewerRef, visibleRef]);

  const goToFile = useCallback(
    (index: number) => {
      const files = visibleRef.current;
      const file = files[Math.min(Math.max(index, 0), files.length - 1)];
      if (file == null) return;
      viewerRef.current?.scrollTo({ type: 'item', id: file.item.id, align: 'start', behavior: 'smooth' });
    },
    [viewerRef, visibleRef]
  );

  const stepHunk = useCallback(
    (delta: number) => {
      const files = visibleRef.current;
      const index = currentIndex();
      const file = files[index];
      if (file == null) return;

      const hunks = file.item.type === 'diff' ? file.item.fileDiff.hunks : [];
      const viewer = viewerRef.current;
      if (viewer == null) return;

      // The hunk nearest the top of the viewport is the one to step from.
      const rendered = viewer.getInstance()?.getRenderedItems() ?? [];
      const element = rendered.find((entry) => entry.id === file.item.id)?.element;
      const offset = element == null ? 0 : -element.getBoundingClientRect().top;
      const height = element == null ? 1 : element.getBoundingClientRect().height;
      const progress = height === 0 ? 0 : offset / height;
      const near = Math.round(progress * Math.max(hunks.length - 1, 0));
      const next = near + delta;

      if (next >= 0 && next < hunks.length) {
        viewer.scrollTo({
          type: 'line',
          id: file.item.id,
          lineNumber: hunks[next]!.additionStart,
          side: 'additions',
          align: 'start',
          behavior: 'smooth',
        });
        return;
      }

      goToFile(index + (delta > 0 ? 1 : -1));
    },
    [currentIndex, goToFile, viewerRef, visibleRef]
  );

  return {
    currentIndex,
    goToFile,
    nextFile: useCallback(() => goToFile(currentIndex() + 1), [currentIndex, goToFile]),
    previousFile: useCallback(() => goToFile(currentIndex() - 1), [currentIndex, goToFile]),
    nextHunk: useCallback(() => stepHunk(1), [stepHunk]),
    previousHunk: useCallback(() => stepHunk(-1), [stepHunk]),
  };
}
