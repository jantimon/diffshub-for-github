import type { CodeViewHandle } from '@pierre/diffs/react';
import { useCallback, useRef } from 'react';

import type { PatchAccumulator } from '@/patch/accumulator';

interface Target {
  id: string;
  lineNumber?: number;
}

/**
 * Walks the diff file by file and hunk by hunk.
 *
 * Positions are read from the items the viewer already holds, so nothing has to
 * be mirrored while the patch is still streaming in.
 */
export function useNavigation(
  viewerRef: { current: CodeViewHandle<undefined, undefined> | null },
  itemsRef: { current: Pick<PatchAccumulator, 'items'> }
) {
  const fileIndex = useRef(-1);
  const hunkIndex = useRef(-1);

  const go = useCallback(
    (target: Target | undefined) => {
      if (target == null) return;
      const viewer = viewerRef.current;
      if (viewer == null) return;
      viewer.scrollTo(
        target.lineNumber == null
          ? { type: 'item', id: target.id, align: 'start', behavior: 'smooth' }
          : {
              type: 'line',
              id: target.id,
              lineNumber: target.lineNumber,
              side: 'additions',
              align: 'start',
              behavior: 'smooth',
            }
      );
    },
    [viewerRef]
  );

  const step = useCallback(
    (delta: number) => {
      const items = itemsRef.current.items;
      if (items.length === 0) return;
      fileIndex.current = clamp(fileIndex.current + delta, items.length);
      hunkIndex.current = -1;
      go({ id: items[fileIndex.current]!.id });
    },
    [go, itemsRef]
  );

  const stepHunk = useCallback(
    (delta: number) => {
      const items = itemsRef.current.items;
      if (items.length === 0) return;
      if (fileIndex.current < 0) fileIndex.current = 0;

      const item = items[fileIndex.current];
      const hunks = item != null && item.type === 'diff' ? item.fileDiff.hunks : [];
      const next = hunkIndex.current + delta;

      if (next >= 0 && next < hunks.length) {
        hunkIndex.current = next;
        go({ id: item!.id, lineNumber: hunks[next]!.additionStart });
        return;
      }

      // Past either end of this file's hunks, carry on into the neighbour.
      const neighbour = fileIndex.current + (delta > 0 ? 1 : -1);
      if (neighbour < 0 || neighbour >= items.length) return;
      fileIndex.current = neighbour;
      const neighbourItem = items[neighbour]!;
      const neighbourHunks = neighbourItem.type === 'diff' ? neighbourItem.fileDiff.hunks : [];
      hunkIndex.current = delta > 0 ? 0 : neighbourHunks.length - 1;
      const hunk = neighbourHunks[hunkIndex.current];
      go({ id: neighbourItem.id, lineNumber: hunk?.additionStart });
    },
    [go, itemsRef]
  );

  return {
    nextFile: useCallback(() => step(1), [step]),
    previousFile: useCallback(() => step(-1), [step]),
    nextHunk: useCallback(() => stepHunk(1), [stepHunk]),
    previousHunk: useCallback(() => stepHunk(-1), [stepHunk]),
  };
}

function clamp(value: number, length: number): number {
  if (value < 0) return 0;
  if (value >= length) return length - 1;
  return value;
}
