import type { CodeViewHandle } from '@pierre/diffs/react';

import type { ReviewThread } from '@/bridge';
import { useCallback } from 'react';

import type { ParsedFile } from '@/patch/accumulator';
import { FILE_GAP } from '@/viewer/diff/codeViewStyles';

/**
 * How far below the top of the pane a file may start and still count as the one
 * being read.
 *
 * The gap between files belongs to neither of them, so a file scrolled to the
 * top of the pane starts that far down. Without allowing for it the file just
 * left looks like the current one and every press lands back on the same file.
 * The few pixels on top cover rounding and a border.
 */
const EDGE_TOLERANCE = FILE_GAP + 4;

/**
 * Where the diff starts on screen.
 *
 * The diff scrolls inside its own pane, which sits below the toolbar, so a file
 * scrolled to the top of that pane is still some way down the window. Measuring
 * against the window instead would make the file above always look like the one
 * being read, and every press would land back on the same file.
 *
 * The pane is found by walking up from the file, through shadow boundaries,
 * rather than being passed in: the viewer library owns that element.
 */
function paneTop(element: Element): number {
  let node: Node | null = element.parentNode;
  while (node != null) {
    if (node instanceof ShadowRoot) {
      node = node.host;
      continue;
    }
    if (node instanceof HTMLElement) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return node.getBoundingClientRect().top;
    }
    node = node.parentNode;
  }
  return 0;
}

/**
 * Walks the diff file by file and hunk by hunk.
 *
 * Where you are is read from what the viewer has on screen rather than from a
 * counter, so scrolling by hand and then pressing a key carries on from what
 * you are actually looking at.
 */
export function useNavigation(
  viewerRef: { current: CodeViewHandle<ReviewThread, undefined> | null },
  visibleRef: { current: readonly ParsedFile[] },
) {
  const currentIndex = useCallback((): number => {
    const files = visibleRef.current;
    const rendered = viewerRef.current?.getInstance()?.getRenderedItems() ?? [];

    // The file you are on is the last one that has reached the top of the diff
    // pane. It has to have reached past the tolerance to count, so that the
    // file just scrolled off does not keep the claim
    const first = rendered[0];
    if (first == null) return 0;
    const edge = paneTop(first.element) + EDGE_TOLERANCE;

    let reached: string | undefined;
    let reachedTop = Number.NEGATIVE_INFINITY;
    let below: string | undefined;
    let belowTop = Number.POSITIVE_INFINITY;

    for (const entry of rendered) {
      const { top } = entry.element.getBoundingClientRect();
      if (top <= edge) {
        if (top > reachedTop) {
          reachedTop = top;
          reached = entry.id;
        }
      } else if (top < belowTop) {
        // Nothing has reached the top yet, so the first file below it is the
        // one being read
        belowTop = top;
        below = entry.id;
      }
    }

    const topId = reached ?? below;
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
    [viewerRef, visibleRef],
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

      // How far down the file the viewport has reached picks the hunk to step
      // from: the viewer renders a file as one element, so the hunks inside it
      // cannot be measured separately from here
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
    [currentIndex, goToFile, viewerRef, visibleRef],
  );

  return {
    currentIndex,
    nextFile: useCallback(() => goToFile(currentIndex() + 1), [currentIndex, goToFile]),
    previousFile: useCallback(() => goToFile(currentIndex() - 1), [currentIndex, goToFile]),
    nextHunk: useCallback(() => stepHunk(1), [stepHunk]),
    previousHunk: useCallback(() => stepHunk(-1), [stepHunk]),
  };
}
