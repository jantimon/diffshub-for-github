/**
 * The look of the diff itself.
 *
 * The viewer library renders the code, the file headers and the file tree into
 * shadow roots, so none of this can live in the ordinary stylesheet: it is
 * handed to each component to adopt. Everything here is about telling one file
 * from the next and one kind of change from another -- the rest of the styling
 * is in `viewer/style.css`.
 */

import { DEFAULT_THEMES } from '@pierre/diffs';
import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react';
import type { CSSProperties } from 'react';

/**
 * The space above a file header, which is what makes a new file read as a new
 * file rather than more of the last one.
 *
 * It is a number rather than a line of CSS because the space belongs to neither
 * file: it sits between them, and anything working out which file is on screen
 * has to allow for it. `useNavigation` imports it for exactly that.
 */
export const FILE_GAP = 26;

export const POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 1) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
};

export const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  langs: ['tsx', 'typescript', 'css', 'go', 'python', 'rust', 'sh', 'cpp'],
};

/**
 * The tree carries its own generous indents. Tightening them buys back the
 * width that deep paths need
 */
export const TREE_STYLE = {
  '--trees-density-override': 0.9,
  '--trees-padding-inline-override': 0,
  '--trees-item-padding-x-override': 2,
  '--trees-git-renamed-color-override': 'light-dark(#0969da, #4493f8)',
} as CSSProperties;

export const TREE_CSS = `
[data-file-tree-search-container] {
  padding-inline: 0;
  margin-right: 0;
}
[data-file-tree-virtualized-scroll='true'] {
  padding-inline-start: 0;
}

/* A folder's tick is fainter than a file's: it is a summary of what is inside
   rather than something ticked off by hand. */
[data-item-type='folder'] [data-item-section='decoration'] {
  opacity: 0.45;
}
`;

/**
 * The bar reads as a heading rather than a control: a bare chevron and a count.
 * Clicking the label already reveals the whole gap, while the chevrons step
 * through it, so the label is marked as clickable and given a verb. Nothing
 * here may change a row's height -- the viewer measures them.
 */
export const SEPARATOR_CSS = `
[data-unmodified-lines] {
  cursor: pointer;
  border-radius: 4px;
}

[data-unmodified-lines]:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
  text-decoration: underline;
}

[data-separator]:hover [data-expand-button] {
  opacity: 1;
}

[data-unmodified-lines]::before {
  content: 'Show ';
}
`;

/**
 * Where one file ends and the next begins. In a long diff the eye needs the
 * break more than it needs the density: a rule and a clear gap above the
 * header, the path in a heavier weight than the code under it, and the change
 * icon large enough to read at a glance.
 *
 * The gap is a margin rather than padding because these headers stick to the
 * top as you scroll, and padding would leave the stuck bar with a dead band
 * above the filename.
 */
/**
 * A lighter tint behind a deleted line, in light mode only.
 *
 * The emphasis tint sits on top of the line background, and at the library's
 * own weight it competes with the code on it. The dark value is unchanged.
 *
 * `light-dark` picks the right one because the viewer library sets
 * `color-scheme` on its shadow host from the resolved theme.
 */
export const DIFF_TINT_CSS = `
/*
 * How far a changed line's background is mixed towards the decoration colour.
 * The viewer's own values leave the tint strong enough to read through, and
 * these were tried in a browser before being chosen.
 */
[data-line],
[data-no-newline] {
  --mix-light: 95%;
  --mix-dark: 94%;
}

:host {
  --diffs-bg-deletion-emphasis-override: light-dark(
    rgb(from var(--diffs-deletion-base) r g b / 0.1),
    rgb(from var(--diffs-deletion-base) r g b / 0.2)
  );
}
`;

export const HEADER_CSS = `
[data-diffs-header] {
  margin-block-start: ${FILE_GAP}px;
  border-block-start: 1px solid var(--dh-border, rgb(128 128 128 / 22%));
}

[data-diffs-header] [data-title] {
  font-weight: 600;
  letter-spacing: 0.1px;
}

[data-diffs-header] [data-change-icon] {
  transform: scale(1.15);
  opacity: 1;
}

[data-diffs-header] [data-header-content] {
  align-items: center;
  padding-block: 2px;
}

[data-diffs-header] slot[name='header-prefix'] {
  display: inline-flex;
  align-items: center;
  line-height: 0;
}

/* A moved file's only signal is its header, so the old path and the arrow get
   enough weight to catch the eye while scrolling. */
[data-prev-name],
[data-rename-icon] {
  color: light-dark(#0969da, #4493f8);
  font-weight: 600;
  opacity: 1;
}

[data-diffs-header]:has([data-prev-name]) [data-title] {
  font-weight: 600;
}
`;
