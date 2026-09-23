import { INNER_RADIUS } from '@/viewer/diff/layout';

/**
 * Where one file ends and the next begins. In a long diff the eye needs the
 * break more than it needs the density: a border round each file and a clear
 * gap between them, the path in a heavier weight than the code under it, and
 * the change icon large enough to read at a glance.
 *
 * The space above a file sits outside it, in the viewer's layout, because
 * these headers stick to the top as you scroll, and space inside would leave
 * the stuck bar with a dead band above the filename.
 */
export const HEADER_CSS = `
/*
 * The file's border is rounded, and the header and the rows are square and
 * fill it edge to edge, so their corners would paint over the border's curve.
 * The header keeps its square background, so that stuck to the top while
 * scrolling it still covers the code going under it, and starts one corner's
 * depth lower instead. A rounded cap in its own colour fills the space above
 * it, and is clipped off with the rest of the file above the pane once the
 * header sticks. The rows are rounded at the bottom and clipped to it.
 */
[data-diffs-header] {
  margin-block-start: ${INNER_RADIUS}px;
}

[data-diffs-header]::before {
  position: absolute;
  inset-inline: 0;
  inset-block-start: -${INNER_RADIUS}px;
  block-size: ${INNER_RADIUS}px;
  content: '';
  background: inherit;
  border-start-start-radius: ${INNER_RADIUS}px;
  border-start-end-radius: ${INNER_RADIUS}px;
}

pre[data-diff] {
  overflow: clip;
  border-end-start-radius: ${INNER_RADIUS}px;
  border-end-end-radius: ${INNER_RADIUS}px;
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
`;
