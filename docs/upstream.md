# What we would ask of `@pierre/diffs` and `@pierre/trees`

Drafts, not filed. Each entry is a place where this extension works around the
library, what it does instead, and the smallest change that would let it stop.
The code that carries each workaround links back here.

Versions read: `@pierre/diffs` 1.4.3, `@pierre/trees` 1.0.0-beta.6.

## diffs

### A public way to read which gaps are open {#expanded-regions}

Find searches the lines a reader has opened as well as the patch. Which gaps
are open is known only to `DiffHunksRenderer.getExpandedHunksMap()`, and the
renderer sits on `FileDiff` as the protected `hunksRenderer`.

Today: `src/viewer/diff/expandedRegions.ts` reads `instance.hunksRenderer`
after each render and copies the map. If the field moves, opened gaps drop out
of find without an error.

Ask: `FileDiff.getExpandedRegions(): ReadonlyMap<number, HunkExpansionRegion>`,
or an `onExpansionChange(fileDiff, regions)` option on `CodeView`.

### A separator that spans both columns of a split view {#spanning-separator}

In a split view the bar for hidden lines is drawn once per column, and each
code column clips what overflows it. A bar centred across the whole line cannot
be built from one element.

Today: `src/viewer/diff/styles/separator.ts` lays each column's copy out at
twice the column's width and centres it on the seam, so the two halves meet.
It depends on the column markup and on `contain: content` staying as it is.

Ask: an option to draw the separator once, across both columns, or a slot for
it outside the clipped columns.

### Where a line is {#line-lookup}

Stepping from hunk to hunk, and marking find matches, both need to know which
line is where. `CodeView.getTopForItem(id)` answers for a file, and nothing
answers for a line.

Today: `src/viewer/diff/useNavigation.ts` and `src/viewer/find/paintMatches.ts`
walk each file's shadow root for `[data-line]` rows and measure them, and skip
rows by `data-line-type`. Any change to that markup breaks both.

Ask: `CodeView.getTopForLine(id, side, lineNumber)` and
`CodeView.getLineAt(scrollTop)`, answering from the layout the viewer already
keeps, so the lookup works for rows that are not drawn.

### Say which worker to use without a bundler, and say when it fails {#worker-portable}

`worker.js` imports `shiki/core`, `diff` and others by bare name. A module
worker resolves no bare specifier, so outside a bundler that rewrites them
(an extension, a plain `<script type="module">`) it fails on its first line.
The pool then highlights on the main thread and says nothing.

Today: `src/viewer/diff/workerPool.ts` loads `worker-portable.js`, found by
reading the package.

Ask: name `worker-portable.js` in the worker pool docs for these cases, and log
one warning when the pool falls back to the main thread.

### Say that margins on a file break the layout {#host-margins}

`CodeView` places each file from the heights it measured plus `layout.gap`. A
CSS margin on a file's host moves every file after it, and nothing says why.

Today: `src/viewer/diff/layout.ts` passes the spacing as the viewer's own
layout and keeps a comment saying why.

Ask: one line in the `layout` docs.

## trees

### `render()` before the tree is mounted draws somewhere else {#render-before-mount}

Asked to render with no container, the tree makes a host of its own, off the
page, and draws into it. When the real container arrives it keeps that
drawing, so the sidebar stays empty until something else redraws it.

Today: `src/viewer/tree/useTreeModel.ts` calls `render()` only once
`getFileTreeContainer()` answers.

Ask: `render()` before mount does nothing, or the first mount draws afresh.

### Keep stylesheets a consumer adds {#adopted-sheets}

Applying a theme sets the shadow root's `adoptedStyleSheets` to the tree's
own list, which drops any sheet added from outside.

Today: `src/viewer/tree/useInViewMarks.ts` checks for its sheet on every update
and adds it back.

Ask: an `unsafeCSS` option as `@pierre/diffs` has, or append to the list
rather than replace it.

### Mark rows without redrawing them {#row-state}

The tick and the find count on a row come from `renderRowDecoration`, which
runs only when rows draw. A change of ticks needs `render()` to show. The bar
beside the files on screen needs to find the list and each row inside the
shadow root.

Today: `src/viewer/tree/useTreeModel.ts` calls `render()` on every change of
ticks or matches, and `src/viewer/tree/useInViewMarks.ts` queries
`[data-file-tree-virtualized-list]` and `[data-item-path]` inside the shadow
root.

Ask: `setItemState(path, attributes)` that sets data attributes on a row and
keeps them across redraws, and a documented part name or selector for the list
and its rows.

### A key handler per row {#row-keys}

Rows are buttons, so Space presses them. The extension wants Space on a file
to mark it viewed and leave the keyboard where it is.

Today: `src/viewer/tree/useTreeModel.ts` listens for keys on the whole window
in the capture phase and works out the row from the event's composed path.

Ask: an `onItemKeyDown(item, event)` option that runs before the row's own
handling and can prevent it.
