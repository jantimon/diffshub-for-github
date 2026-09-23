/**
 * Lighter tints behind changed lines.
 *
 * At the library's own weights the tint competes with the code on it: the line
 * backgrounds are mixed less towards the change colour in both modes, and the
 * emphasis on a deleted word is lighter in light mode.
 *
 * `light-dark` picks the right one because the viewer library sets
 * `color-scheme` on its shadow host from the resolved theme.
 */
export const DIFF_TINT_CSS = `
/* How far a changed line's background is mixed towards the change colour */
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
