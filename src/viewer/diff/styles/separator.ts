/**
 * The bar for lines the diff does not show: one bar, centred across the whole
 * line, with a chevron either side of its label. Clicking the label reveals
 * the whole gap and the chevrons step through it, so the label is given a
 * verb. Nothing here may change a row's height -- the viewer measures them.
 *
 * The viewer draws the bar in every column, and each code column clips what
 * overflows it, so no one element can cross from the old side to the new. So
 * the copy in each half of a split view is laid out twice as wide as its
 * column and centred on the line between them: each column shows its half,
 * and the halves meet in the middle. Both copies are the viewer's own, so a
 * click on either half does what it always did. `docs/upstream.md#spanning-separator`
 * asks for a bar the viewer draws once.
 *
 * Measures used below: 100% is the width of the line-number column, the box
 * the bar is placed in, and 100cqi the width of the code column.
 */
export const SEPARATOR_CSS = `
/* Only a gap that can be opened says so. The viewer leaves the index off one
   that cannot, as when no commit is known to load the file from */
[data-expand-index] [data-unmodified-lines]::before {
  content: 'Show ';
}

[data-gutter] [data-separator^='line-info'] [data-separator-wrapper] {
  --dh-bar: light-dark(color-mix(in lab, var(--diffs-bg) 98%, var(--diffs-mixer)), var(--diffs-bg-separator));

  z-index: 2;
  display: flex;
  box-sizing: border-box;
  align-items: stretch;
  justify-content: center;
  padding-inline-start: 0;
  /* The hatching of a missing row, the viewer's own, over a lighter grey in
     light mode: the bar stands for lines that are there but not shown */
  background-color: var(--dh-bar);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent calc(3px * 1.414),
    var(--diffs-bg-buffer) calc(3px * 1.414),
    var(--diffs-bg-buffer) calc(4px * 1.414)
  );
  background-position: 5px 0;
  background-size: 8px 8px;
  background-origin: border-box;

  /* The label and the chevrons sit on the plain grey, so the stripes never
     run through the text */
  & [data-separator-content],
  & [data-expand-button] {
    background-color: var(--dh-bar);
  }

  /* As wide as its text: the viewer lets it grow to fill the bar */
  & [data-separator-content] {
    flex: none;
    order: 1;
    padding-inline: 4px;
  }

  /* Underlining on hover would mark only the half under the pointer */
  & [data-separator-content]:hover {
    text-decoration: none;
  }

  & [data-expand-button] {
    border: 0;
    border-radius: 4px;
  }

  & [data-expand-button]:hover {
    background-color: color-mix(in srgb, currentColor 10%, var(--dh-bar));
  }

  /* A gap opening both ways has a chevron for each way: up before the label,
     down after it. The viewer stacks them otherwise */
  &[data-separator-multi-button] [data-expand-down] {
    order: 2;
  }

  /* At the far end of the line, out of the flow so the label stays centred.
     Each half has a copy at the end of its bar: in a split view the old
     side's lies past its column and is clipped, so the one seen is the new
     side's, at the end of the line */
  & [data-expand-all-button] {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 4px;
    display: flex;
    padding-inline: 8px;
  }
}

/* The old side, or the only side: from where the code starts, with as much
   room again after the end as the line numbers take, so the middle of the
   label lands on the middle of the line */
:is([data-deletions], [data-unified]) [data-gutter] [data-separator^='line-info'] [data-separator-wrapper] {
  inset-inline-start: 100%;
  /* This copy starts a line-number column further in than the other half's,
     so its stripes are drawn from where that half's start, to run on
     unbroken across the middle */
  background-position: calc(5px - var(--diffs-column-number-width, 0px)) 0;
  inline-size: calc(100cqi - 100%);
  padding-inline-end: 100%;
  border-start-start-radius: 6px;
  border-end-start-radius: 6px;
}

/* Over the line numbers the bar is left plain, as the rows the diff pads a side
   with are: the viewer fills that cell grey, and it showed as a block before
   the stripes began */
[data-gutter] [data-separator^='line-info'] {
  background-color: var(--diffs-bg);
}

[data-deletions] [data-gutter] [data-separator^='line-info'] [data-separator-wrapper] {
  inline-size: calc(200cqi - 100%);
}

/* The new side of a split view: the same bar, centred on the same line. The
   viewer hides this copy's label and chevrons, which are shown again here */
[data-additions] [data-gutter] [data-separator^='line-info'] [data-separator-wrapper] {
  inset-inline-start: -100cqi;
  inline-size: 200cqi;
  border-radius: 0 6px 6px 0;

  & [data-separator-content],
  & [data-expand-button] {
    display: flex;
  }
}

/*
 * The divider between the two sides of a split view: a band of the page's
 * background at the end of the old column, wide enough that a removed line
 * and the added line beside it read as two sides. The viewer draws it as a
 * border on both sides, which sits outside what either column can paint over,
 * so it would run as a line through the middle of every bar, and it leaves the
 * two columns a pixel apart in width, so the halves would not meet. Drawn
 * inside the old column instead, it takes no width the viewer measures, and
 * the bar, one layer up, covers it where the halves meet.
 */
[data-deletions] {
  position: relative;
  border-inline-end: 0;
}

[data-additions] {
  border-inline-start: 0;
}

[data-deletions]::after {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 1;
  inline-size: 8px;
  pointer-events: none;
  content: '';
  background-color: var(--diffs-bg);
}

/* A gap with a single chevron gets the same shape after the label too. It is
   part of the label, and the label already opens the whole gap */
[data-gutter] [data-expand-index] [data-separator-wrapper]:not([data-separator-multi-button]) [data-unmodified-lines]::after {
  display: inline-block;
  inline-size: 16px;
  block-size: 16px;
  margin-inline-start: 6px;
  vertical-align: -3px;
  content: '';
  background-color: currentColor;
  mask: var(--dh-expand-icon) center / 16px no-repeat;
}

[data-gutter] [data-separator-wrapper]:has([data-expand-both]) {
  --dh-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z'/%3E%3C/svg%3E");
}

/* The viewer flips the chevron of an expand-down button, so the copy is flipped
   the same way: up for down, down for up */
[data-gutter] [data-separator-wrapper]:has([data-expand-down]) {
  --dh-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath transform='rotate(180 8 8)' d='M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06'/%3E%3C/svg%3E");
}

[data-gutter] [data-separator-wrapper]:has([data-expand-up]) {
  --dh-expand-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06'/%3E%3C/svg%3E");
}
`;
