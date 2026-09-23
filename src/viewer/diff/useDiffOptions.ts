import type { CodeViewItem, CodeViewReactOptions, FileDiffContentsLoader } from '@pierre/diffs/react';
import { useEffect, useMemo, useRef } from 'react';

import type { PageInfo, ReviewThread } from '@/shared/bridge';
import { FILE_GAP, SPACE_ABOVE_FILE } from '@/viewer/diff/layout';
import { ANNOTATION_CSS } from '@/viewer/diff/styles/annotation';
import { FIND_CSS } from '@/viewer/diff/styles/find';
import { HEADER_CSS } from '@/viewer/diff/styles/header';
import { SEPARATOR_CSS } from '@/viewer/diff/styles/separator';
import { DIFF_TINT_CSS } from '@/viewer/diff/styles/tint';

/**
 * What the diff viewer is told: layout, theme, the styles it adopts, and what
 * happens on a click in the gutter or after it draws a file.
 *
 * `afterRender` is held in a ref, so the options do not change whenever the
 * code behind it does: new options make the viewer lay every file out again.
 */
export function useDiffOptions({
  diffStyle,
  themeType,
  page,
  commenting,
  loadDiffFiles,
  onComment,
  afterRender,
}: {
  diffStyle: 'split' | 'unified';
  themeType: 'light' | 'dark';
  page: PageInfo;
  /** Whether the gutter offers to start a comment */
  commenting: boolean;
  loadDiffFiles: FileDiffContentsLoader | undefined;
  onComment: (path: string, line: number, side: 'additions' | 'deletions') => void;
  /** Runs after the viewer draws a file, with the file's instance */
  afterRender: (instance: unknown) => void;
}): CodeViewReactOptions<ReviewThread, undefined> {
  const afterRenderRef = useRef(afterRender);
  useEffect(() => {
    afterRenderRef.current = afterRender;
  });

  return useMemo<CodeViewReactOptions<ReviewThread, undefined>>(
    () => ({
      layout: { paddingTop: SPACE_ABOVE_FILE, gap: FILE_GAP, paddingBottom: 0 },
      diffStyle,
      themeType,
      theme: { light: page.lightTheme, dark: page.darkTheme },
      stickyHeaders: true,
      overflow: 'scroll',
      lineHoverHighlight: 'number',
      enableLineSelection: true,
      enableGutterUtility: commenting,
      onGutterUtilityClick(
        range: { start: number; side?: string },
        context: { item: CodeViewItem<ReviewThread> },
      ) {
        const item = context.item;
        if (item.type !== 'diff') return;
        onComment(item.fileDiff.name, range.start, range.side === 'deletions' ? 'deletions' : 'additions');
      },
      unsafeCSS: `${HEADER_CSS}\n${SEPARATOR_CSS}\n${DIFF_TINT_CSS}\n${ANNOTATION_CSS}\n${FIND_CSS}`,
      loadDiffFiles,
      /** A file leaving the screen reports too, and has nothing to add */
      onPostRender: (_node: HTMLElement, instance: unknown, phase: string) => {
        if (phase !== 'unmount') afterRenderRef.current(instance);
      },
    }),
    [diffStyle, themeType, page.lightTheme, page.darkTheme, commenting, loadDiffFiles, onComment],
  );
}
