import type { ParsedFile } from '@/patch/accumulator';
import { FILE_GAP } from '@/viewer/diff/codeViewStyles';

/**
 * The files with any part inside the diff pane, in the order they are drawn.
 *
 * Worked out from where the viewer has laid each file out rather than from the
 * DOM, so a scroll frame reads no layout. Files are in patch order and each
 * one ends where the next begins, less the gap between them, which makes the
 * first file in view a binary search away and the rest a short walk.
 */
export function filesInView(
  files: readonly ParsedFile[],
  topOf: (id: string) => number | undefined,
  scrollTop: number,
  paneHeight: number,
): string[] {
  const viewBottom = scrollTop + paneHeight;
  const bottomOf = (index: number): number => {
    const next = files[index + 1];
    const nextTop = next == null ? undefined : topOf(next.item.id);
    return nextTop == null ? Number.POSITIVE_INFINITY : nextTop - FILE_GAP;
  };

  // The first file that has not ended above the pane
  let low = 0;
  let high = files.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bottomOf(middle) <= scrollTop) low = middle + 1;
    else high = middle;
  }

  const inView: string[] = [];
  for (let index = low; index < files.length; index += 1) {
    const file = files[index];
    const top = file == null ? undefined : topOf(file.item.id);
    if (file == null || top == null || top >= viewBottom) break;
    inView.push(file.item.id);
  }
  return inView;
}
