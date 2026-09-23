/**
 * The marks find paints over the code. They live here rather than in the
 * viewer's stylesheet because a highlight is styled from inside the shadow root
 * its text sits in. Yellow for every match and orange for the current one, the
 * colours a browser's own find uses, so they read at once.
 */
export const FIND_CSS = `
::highlight(dh-find) {
  background-color: light-dark(#fff3a3, #7a6400);
  color: inherit;
}

::highlight(dh-find-current) {
  background-color: light-dark(#ff9632, #c75c00);
  color: light-dark(#000, #fff);
}
`;
