import type { CodeViewHandle } from '@pierre/diffs/react';
import type { FileTree } from '@pierre/trees';
import { useCallback, useEffect, useRef } from 'react';

import type { ReviewThread } from '@/shared/bridge';
import type { ParsedFile } from '@/patch/accumulator';
import { filesInView } from '@/viewer/diff/filesInView';
import { inViewCss, inViewRowsCss } from '@/viewer/diff/codeViewStyles';

const ANCHORS = typeof CSS !== 'undefined' && CSS.supports('anchor-name: --a');

/**
 * The row that stands for a file: its own, or the outermost folder that is
 * closed over it, so the mark never points at a row that is not there
 */
function rowFor(model: FileTree, path: string): string {
  const parts = path.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    const folder = `${parts.slice(0, depth).join('/')}/`;
    const handle = model.getItem(folder);
    if (handle != null && 'isExpanded' in handle && !handle.isExpanded()) return folder;
  }
  return path;
}

/**
 * Marks the files on screen in the diff with a bar beside their rows in the
 * tree, so the tree shows where the reader is.
 *
 * Nothing here goes through React or redraws the tree. The bar is one element
 * of ours inside the tree's list, placed by one adopted stylesheet that is
 * rewritten only when what it says changes, which most scroll frames it does
 * not.
 *
 * Answers a function to call when the diff's layout changed without a scroll,
 * as when a gap opens or more of the patch arrives.
 */
export function useInViewMarks({
  viewerRef,
  visibleRef,
  model,
}: {
  viewerRef: { current: CodeViewHandle<ReviewThread, undefined> | null };
  visibleRef: { current: readonly ParsedFile[] };
  model: FileTree;
}): () => void {
  const sheet = useRef<CSSStyleSheet | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const scrollTop = useRef(0);
  const paneHeight = useRef(0);
  const written = useRef('');
  const turn = useRef<0 | 1>(0);
  const frame = useRef(0);

  const update = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const view = viewerRef.current?.getInstance();
      const root = model.getFileTreeContainer()?.shadowRoot;
      const list = root?.querySelector('[data-file-tree-virtualized-list]');
      if (view == null || root == null || list == null) return;

      // The tree sets its own adopted stylesheets as it applies a theme, which
      // replaces the list and drops this one, so it is checked every time
      sheet.current ??= new CSSStyleSheet();
      if (!root.adoptedStyleSheets.includes(sheet.current))
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet.current];

      const files = visibleRef.current;
      const ids = new Set(
        filesInView(files, (id) => view.getTopForItem(id), scrollTop.current, paneHeight.current),
      );
      const paths = files.filter((file) => ids.has(file.item.id)).map((file) => file.path);

      if (!ANCHORS) {
        const css = inViewRowsCss(paths);
        if (css !== written.current) sheet.current.replaceSync(css);
        written.current = css;
        return;
      }

      // The tree redraws its list as it scrolls, and may drop an element it
      // did not make, so the bar is put back whenever it has gone
      if (bar.current == null) {
        bar.current = document.createElement('div');
        bar.current.dataset.dhInView = '';
        bar.current.setAttribute('aria-hidden', 'true');
      }
      if (bar.current.parentNode !== list) list.append(bar.current);

      const first = paths[0] == null ? undefined : rowFor(model, paths[0]);
      const last = paths.at(-1) == null ? undefined : rowFor(model, paths.at(-1) ?? '');
      // Neither end drawn means the reader has scrolled the tree elsewhere, and
      // a bar running the length of the list would say nothing
      const drawn = (path: string | undefined) =>
        path != null && root.querySelector(`[data-item-path="${CSS.escape(path)}"]`) != null;
      bar.current.hidden = first == null || last == null || (!drawn(first) && !drawn(last));

      const key = `${first}\n${last}`;
      if (first == null || last == null || key === written.current) return;
      written.current = key;
      turn.current = turn.current === 0 ? 1 : 0;
      sheet.current.replaceSync(inViewCss(first, last, turn.current));
    });
  }, [model, viewerRef, visibleRef]);

  useEffect(() => {
    const view = viewerRef.current?.getInstance();
    const pane = view?.getContainerElement();
    if (view == null || pane == null) return undefined;

    // The height is read here and when it changes, never while scrolling
    const resize = new ResizeObserver(([entry]) => {
      paneHeight.current = entry?.contentRect.height ?? pane.clientHeight;
      update();
    });
    resize.observe(pane);

    const unsubscribeScroll = view.subscribeToScroll((top) => {
      scrollTop.current = top;
      update();
    });
    // A folder opening or closing moves which row stands for a file
    const unsubscribeTree = model.subscribe(update);
    // Scrolling the tree redraws its rows, which can take the bar with them
    const treeScroll = model
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector('[data-file-tree-virtualized-scroll]');
    treeScroll?.addEventListener('scroll', update, { passive: true });

    return () => {
      unsubscribeScroll();
      unsubscribeTree();
      treeScroll?.removeEventListener('scroll', update);
      resize.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [model, update, viewerRef]);

  return update;
}
