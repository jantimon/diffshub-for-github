/**
 * The review conversations, and the box for starting a new one.
 *
 * Comments are read from GitHub once when the overlay opens and re-read after
 * every write, so what is on screen is what GitHub has rather than a guess at
 * it. Writes go through the content script: GitHub refuses one that carries any
 * origin but its own.
 *
 * A comment being written is held here as a thread like any other, marked as a
 * draft. That way the composer is positioned, scrolled and recycled by exactly
 * the same code as a real conversation, instead of being a second thing the
 * viewer has to place.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReviewThread } from '@/bridge';
import { ask } from '@/viewer/ask';
import type { CodeViewItem } from '@pierre/diffs/react';

export interface Threads {
  /** The diff's items with each conversation hung on the file it belongs to. */
  items: readonly CodeViewItem<ReviewThread>[];
  /** Opens the composer against one line. */
  openDraft: (path: string, line: number, side: 'additions' | 'deletions') => void;
  closeDraft: () => void;
  reply: (thread: ReviewThread, body: string) => Promise<string | undefined>;
  resolve: (thread: ReviewThread) => Promise<string | undefined>;
  post: (thread: ReviewThread, text: string) => Promise<string | undefined>;
  /** Re-reads the conversations, for a change made somewhere other than here. */
  reload: () => Promise<void>;
}

export function useThreads(
  items: readonly CodeViewItem<ReviewThread>[],
  onNotice: (message: string) => void
): Threads {
  const [threads, setThreads] = useState<readonly ReviewThread[]>([]);
  const [draft, setDraft] = useState<ReviewThread | undefined>(undefined);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask('threads').then((result) => {
      setThreads(result.threads);
      if (result.error != null) onNotice(`Comments: ${result.error}`);
      else if (result.truncated) {
        onNotice('GitHub returned only the most recent comments on this pull request.');
      }
    });
  }, [onNotice]);

  const reload = useCallback(async (): Promise<void> => {
    const result = await ask('threads');
    setThreads(result.threads);
    if (result.error != null) onNotice(`Comments: ${result.error}`);
  }, [onNotice]);

  // The viewer ignores an item whose version it has already seen, and the
  // version is worked out from the item the stream produced, so it has to count
  // up by itself rather than from what that item carries.
  const revision = useRef(0);

  // Annotations live on the item, so hang each thread on the file it belongs to.
  const withThreads = useMemo(() => {
    revision.current += 1;
    const all = draft == null ? threads : [...threads, draft];
    if (all.length === 0) return items;

    const byPath = new Map<string, ReviewThread[]>();
    for (const thread of all) {
      const list = byPath.get(thread.path);
      if (list == null) byPath.set(thread.path, [thread]);
      else list.push(thread);
    }

    return items.map((item) => {
      if (item.type !== 'diff') return item;
      const list = byPath.get(item.fileDiff.name);
      if (list == null) return item;
      return {
        ...item,
        annotations: list
          .map((thread) => ({
            side: thread.side,
            // A comment on the file, or one whose lines have since changed,
            // goes to the top of the file rather than to a line it no longer
            // fits.
            lineNumber: thread.isOutdated || thread.line == null ? 0 : thread.line,
            metadata: thread,
          }))
          .sort((a, b) => a.lineNumber - b.lineNumber),
        version: (item.version ?? 0) + revision.current,
      };
    });
  }, [draft, items, threads]);

  const openDraft = useCallback((path: string, line: number, side: 'additions' | 'deletions') => {
    setDraft({
      id: 'draft',
      path,
      line,
      side,
      isResolved: false,
      isOutdated: false,
      isDraft: true,
      comments: [],
    });
  }, []);

  const closeDraft = useCallback(() => setDraft(undefined), []);

  const reply = useCallback(
    async (thread: ReviewThread, body: string): Promise<string | undefined> => {
      // A reply answers the first comment in the thread, which is what GitHub's
      // own reply form names.
      const inReplyTo = thread.comments[0]?.databaseId ?? '';
      const result = await ask('reply', { inReplyTo, body });
      if (!result.ok) return result.error ?? 'GitHub refused the reply.';
      await reload();
      return undefined;
    },
    [reload]
  );

  const resolve = useCallback(
    async (thread: ReviewThread): Promise<string | undefined> => {
      const result = await ask('resolve', { threadId: thread.id, resolved: !thread.isResolved });
      if (!result.ok) return result.error ?? 'GitHub refused that.';
      await reload();
      return undefined;
    },
    [reload]
  );

  const post = useCallback(
    async (thread: ReviewThread, text: string): Promise<string | undefined> => {
      const result = await ask('comment', {
        path: thread.path,
        line: thread.line ?? 0,
        side: thread.side,
        text,
      });
      if (!result.ok) return result.error ?? 'GitHub refused the comment.';
      setDraft(undefined);
      await reload();
      return undefined;
    },
    [reload]
  );

  return { items: withThreads, openDraft, closeDraft, reply, resolve, post, reload };
}
