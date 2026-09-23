/**
 * The row a conversation sits in.
 *
 * In split view the viewer renders one comment as two cells, one per column,
 * and tints all four tracks -- two gutters, two columns -- so the row reads as
 * unchanged code. Between them run five strips of the page background: a gap
 * after each gutter, and the seam down the middle of the diff. Those strips are
 * painted by the columns themselves and cannot be recoloured for one row.
 *
 * So the row takes the page background instead of the tint. The strips then
 * match it, the seven pieces become one field across the whole file, and the
 * card is the only thing on it.
 *
 * `--diffs-annotation-bg` is the one variable to set: it feeds the decoration
 * colour, which feeds the line colour, which is what the row is painted with.
 * Only colour is set here, so the pair of cells and the height the viewer
 * measures across them are left alone.
 */
export const ANNOTATION_CSS = `
[data-line-annotation],
[data-gutter-buffer='annotation'] {
  --diffs-annotation-bg: var(--diffs-bg);
}
`;
