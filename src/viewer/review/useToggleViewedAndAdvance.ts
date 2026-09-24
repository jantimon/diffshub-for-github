import type { CodeViewHandle } from '@pierre/diffs/react';
import { useCallback } from 'react';

import type { ReviewThread } from '@/shared/bridge';
import { whenScrolled } from '@/viewer/diff/whenScrolled';
import type { Session } from '@/viewer/state/session';

/**
 * Ticking a file off moves to the next one still to read and puts the
 * keyboard on its eye, so the whole review is Space, read, Space. Files
 * already read are skipped: stopping on one would mean ticking it off again or
 * stepping past it by hand. Unticking a file leaves you on it, because you went
 * back to it on purpose.
 */
export function useMarkViewed({
  session,
  viewerRef,
  toggle,
}: {
  session: Session;
  viewerRef: { current: CodeViewHandle<ReviewThread, undefined> | null };
  toggle: (path: string) => void;
}): (path: string) => void {
  return useCallback(
    (path: string) => {
      const { visible, viewed } = session.get();
      const wasViewed = viewed.has(path);
      toggle(path);
      if (wasViewed) return;

      const seen = session.get().viewed;
      const from = visible.findIndex((file) => file.path === path);
      const next =
        visible.slice(from + 1).find((file) => !seen.has(file.path)) ??
        // Nothing unread below, so fall back to anything unread above: the
        // reader may have worked through the list out of order
        visible.slice(0, from).find((file) => !seen.has(file.path));
      if (next == null) return;

      const viewer = viewerRef.current;
      viewer?.scrollTo({ type: 'item', id: next.item.id, align: 'start', behavior: 'smooth' });
      whenScrolled(viewer?.getInstance()?.getContainerElement(), () => {
        document.querySelector<HTMLElement>(`[data-dh-viewed="${CSS.escape(next.item.id)}"]`)?.focus();
      });
    },
    [session, toggle, viewerRef],
  );
}
