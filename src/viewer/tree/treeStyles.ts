import type { CSSProperties } from 'react';

/**
 * The tree carries its own generous indents. Tightening them buys back the
 * width that deep paths need
 */
export const TREE_STYLE = {
  '--trees-density-override': 0.9,
  '--trees-padding-inline-override': 0,
  '--trees-item-padding-x-override': '2px',
  '--trees-git-renamed-color-override': 'light-dark(#0969da, #4493f8)',
} as CSSProperties;

export const TREE_CSS = `
[data-file-tree-search-container] {
  padding-inline: 0;
}
[data-file-tree-virtualized-scroll='true'] {
  padding-inline-start: 0;
}

/* The rows are tightened to buy width for deep paths. The search box is not a
   row, and its text needs room from the edge. */
[data-file-tree-search-input] {
  padding-inline: 8px;
}

/* A folder's tick is fainter than a file's: it is a summary of what is inside
   rather than something ticked off by hand. */
[data-item-type='folder'] [data-item-section='decoration'] {
  opacity: 0.45;
}

/* The row the keyboard is on, or that was just clicked: a faint tint rather
   than the tree's own ring, which outweighed everything else in the panel. */
[data-type='item'][data-item-focused='true']::before,
[data-type='item']:focus-visible::before {
  outline: none;
}

[data-type='item'][data-item-focused='true'],
[data-type='item']:focus-visible {
  background-color: color-mix(in srgb, var(--dh-accent) 8%, transparent);
}

/* The bar beside the rows of the files on screen in the diff. Faint, so the
   focused row, the ticks and the find counts all read first. */
[data-dh-in-view] {
  position: absolute;
  left: 0;
  z-index: 1;
  width: 2px;
  pointer-events: none;
  background: color-mix(in srgb, var(--dh-accent) 45%, transparent);
  border-radius: 1px;
  transition:
    top 160ms ease-out,
    bottom 160ms ease-out;
}
`;

/** A path inside a quoted attribute selector */
function quotedPath(path: string): string {
  return `"${CSS.escape(path)}"`;
}

/** A tree row by its path, leaving out the copies the tree pins at the top */
function rowSelector(path: string): string {
  return `[data-item-path=${quotedPath(path)}]:not([data-file-tree-sticky-row])`;
}

/**
 * Where the in-view bar runs in the tree: from the top of the first row on
 * screen in the diff to the bottom of the last.
 *
 * The two rows are named as anchors and the bar is placed between them with
 * CSS anchor positioning. The names alternate between two sets on each change:
 * a new name is a new computed value, which is what starts the transition, so
 * the bar slides rather than jumps. A row the tree has not drawn leaves its end
 * of the bar at the edge of the list, so the bar still points the right way.
 */
export function inViewCss(first: string, last: string, turn: 0 | 1): string {
  const start = `--dh-view-start-${turn}`;
  const end = `--dh-view-end-${turn}`;
  const names =
    first === last
      ? `${rowSelector(first)} { anchor-name: ${start}, ${end}; }`
      : `${rowSelector(first)} { anchor-name: ${start}; }\n${rowSelector(last)} { anchor-name: ${end}; }`;
  return `${names}
[data-dh-in-view] {
  top: anchor(${start} top, 0px);
  bottom: anchor(${end} bottom, 0px);
}`;
}
