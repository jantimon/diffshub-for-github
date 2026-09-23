import type { CodeViewHandle } from '@pierre/diffs/react';

import type { ReviewThread } from '@/shared/bridge';
import { useCallback } from 'react';

import type { Session } from '@/viewer/state/session';

/** A file this close under the top of the pane already counts as reached: rounding and a border */
const EDGE_TOLERANCE = 4;

/** The hunk holding a new-file line, or the one before it: -1 above the first */
function hunkAt(hunks: readonly { additionStart: number }[], line: number): number {
  let found = -1;
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.additionStart > line) break;
    found = index;
  }
  return found;
}

/**
 * The first line of the new side the reader can see in a file: the top row
 * below the file's own header, which sticks and covers what scrolls under it.
 * Removed lines are skipped, since their numbers belong to the old side.
 * The viewer has no lookup by line: `docs/upstream.md#line-lookup`.
 */
function firstLineOnScreen(element: HTMLElement, paneTop: number): number | undefined {
  const root = element.shadowRoot ?? element;
  // The header is measured rather than assumed: it is whatever height the
  // viewer and this extension's styles make it
  const header = root.querySelector('[data-diffs-header]')?.getBoundingClientRect().bottom ?? paneTop;
  const below = Math.max(paneTop, header);
  for (const row of root.querySelectorAll<HTMLElement>('code:not([data-deletions]) [data-line]')) {
    if (row.dataset.lineType === 'change-deletion') continue;
    // A line counts once most of it shows: the viewer leaves a sliver of the
    // line before the one it scrolled to
    const { top, bottom } = row.getBoundingClientRect();
    if ((top + bottom) / 2 > below) return Number(row.dataset.line);
  }
  return undefined;
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
  session: Session,
) {
  /**
   * The file being read: the last one whose top has reached the top of the
   * pane. Worked out from where the viewer laid the files out, which is what
   * the tree's in-view bar uses too, so the two never disagree.
   */
  const currentIndex = useCallback((): number => {
    const files = session.get().visible;
    const view = viewerRef.current?.getInstance();
    const scrollTop = view?.getContainerElement()?.scrollTop ?? 0;
    let low = 0;
    let high = files.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const file = files[middle];
      const top = file == null ? undefined : view?.getTopForItem(file.item.id);
      if (top != null && top <= scrollTop + EDGE_TOLERANCE) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }, [viewerRef, session]);

  const goToFile = useCallback(
    (index: number) => {
      const files = session.get().visible;
      const file = files[Math.min(Math.max(index, 0), files.length - 1)];
      if (file == null) return;
      viewerRef.current?.scrollTo({ type: 'item', id: file.item.id, align: 'start', behavior: 'smooth' });
    },
    [viewerRef, session],
  );

  const stepHunk = useCallback(
    (delta: number) => {
      const files = session.get().visible;
      const index = currentIndex();
      const file = files[index];
      if (file == null) return;

      const hunks = file.item.fileDiff.hunks;
      const viewer = viewerRef.current;
      const view = viewer?.getInstance();
      if (viewer == null || view == null) return;

      // Stepping goes from the hunk the reader is looking at, found from the
      // first line on screen rather than guessed from how far down the file
      // they are, which hunks of different lengths would throw off
      const element = view.getRenderedItems().find((entry) => entry.id === file.item.id)?.element;
      const paneTop = view.getContainerElement()?.getBoundingClientRect().top ?? 0;
      const line = element == null ? undefined : firstLineOnScreen(element, paneTop);
      const current = line == null ? -1 : hunkAt(hunks, line);
      const next = current + delta;

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
    [currentIndex, goToFile, viewerRef, session],
  );

  return {
    currentIndex,
    nextFile: useCallback(() => goToFile(currentIndex() + 1), [currentIndex, goToFile]),
    previousFile: useCallback(() => goToFile(currentIndex() - 1), [currentIndex, goToFile]),
    nextHunk: useCallback(() => stepHunk(1), [stepHunk]),
    previousHunk: useCallback(() => stepHunk(-1), [stepHunk]),
  };
}
