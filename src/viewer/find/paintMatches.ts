import type { FindMatch, FindSide } from '@/patch/findInPatch';
import { matchesIn } from '@/patch/findInPatch';

export const ALL_MATCHES = 'dh-find';
export const CURRENT_MATCH = 'dh-find-current';

interface RenderedFile {
  id: string;
  element: HTMLElement;
}

/**
 * Marks every match in the rows on screen, and the current one more strongly.
 *
 * The CSS Custom Highlight API paints over text without touching the DOM, so
 * no row changes height and the viewer has nothing to measure again. Only the
 * rows that exist are painted, and the rest as they scroll in. They are found
 * by walking each file's rows: `docs/upstream.md#line-lookup`.
 */
export function paintMatches(
  rendered: readonly RenderedFile[],
  pattern: RegExp | undefined,
  current: FindMatch | undefined,
): void {
  if (pattern == null) {
    clearMatches();
    return;
  }

  const all: Range[] = [];
  const now: Range[] = [];
  for (const { id, element } of rendered) {
    const root = element.shadowRoot ?? element;
    for (const row of root.querySelectorAll<HTMLElement>('code [data-line]')) {
      const text = row.textContent ?? '';
      if (text === '') continue;
      const side = sideOf(row);
      const lineNumber = Number(row.dataset.line);
      for (const { start, end } of matchesIn(text, pattern)) {
        const range = rangeIn(row, start, end);
        if (range == null) continue;
        const isCurrent =
          current != null &&
          current.id === id &&
          current.side === side &&
          current.lineNumber === lineNumber &&
          current.start === start;
        (isCurrent ? now : all).push(range);
      }
    }
  }

  CSS.highlights.set(ALL_MATCHES, new Highlight(...all));
  const strong = new Highlight(...now);
  strong.priority = 1;
  CSS.highlights.set(CURRENT_MATCH, strong);
}

export function clearMatches(): void {
  CSS.highlights.delete(ALL_MATCHES);
  CSS.highlights.delete(CURRENT_MATCH);
}

/**
 * A split view draws each side in a column of its own. A unified one has a
 * single column, where a removed line says so on the row
 */
function sideOf(row: HTMLElement): FindSide {
  const column = row.closest('code');
  if (column?.hasAttribute('data-deletions') === true) return 'deletions';
  if (column?.hasAttribute('data-additions') === true) return 'additions';
  return row.dataset.lineType === 'change-deletion' ? 'deletions' : 'additions';
}

/** Tokens split a line into many text nodes, so an offset is walked to across them */
function rangeIn(row: HTMLElement, start: number, end: number): Range | undefined {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let begun = false;
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!begun && start < seen + length) {
      range.setStart(node, start - seen);
      begun = true;
    }
    if (begun && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return undefined;
}
