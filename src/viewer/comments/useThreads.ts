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

import type { ReviewComment, ReviewThread } from '@/shared/bridge';
import { ask } from '@/viewer/bridge/ask';
import { useChoice } from '@/viewer/settings';
import type { CodeViewDiffItem } from '@pierre/diffs';

export interface Threads {
  /** The diff's items with each conversation hung on the file it belongs to */
  items: readonly CodeViewDiffItem<ReviewThread>[];
  /** Reading only: no conversations on the diff and no way to start one */
  hidden: boolean;
  /** Shows the conversations, or takes them off the diff */
  toggleHidden: () => void;
  /** Opens the composer against one line */
  openDraft: (path: string, line: number, side: 'additions' | 'deletions') => void;
  /** Throws away whatever is in the composer and takes it off the diff */
  closeDraft: () => void;
  /** Answers a conversation, resolving to GitHub's reason for refusing or to nothing */
  reply: (thread: ReviewThread, body: string) => Promise<string | undefined>;
  /** Settles a conversation, or reopens a settled one */
  resolve: (thread: ReviewThread) => Promise<string | undefined>;
  /** Rewrites one of the reader's own comments */
  edit: (comment: ReviewComment, body: string) => Promise<string | undefined>;
  /** Takes one of the reader's own comments down */
  remove: (comment: ReviewComment) => Promise<string | undefined>;
  /** Sends the drafted comment to GitHub and closes the composer */
  post: (thread: ReviewThread, text: string) => Promise<string | undefined>;
  /** Re-reads the conversations, for a change made somewhere other than here */
  reload: () => Promise<void>;
}

export function useThreads(
  items: readonly CodeViewDiffItem<ReviewThread>[],
  onNotice: (message: string) => void,
): Threads {
  const [threads, setThreads] = useState<readonly ReviewThread[]>([]);
  const [draft, setDraft] = useState<ReviewThread | undefined>(undefined);
  const [comments = 'show', setComments] = useChoice('comments', ['show', 'hide'] as const, 'show');
  const hidden = comments === 'hide';

  /**
   * Counts up every time the conversations change, and feeds the item version
   * the viewer compares against.
   *
   * It has to keep rising rather than describe the current state: resolving a
   * conversation and reopening it would land back on a version the viewer has
   * already drawn, and it would not redraw. Every change comes from one of the
   * writers below, so this is bumped there rather than while rendering.
   */
  const [revision, setRevision] = useState(0);
  const bumpRevision = useCallback(() => setRevision((count) => count + 1), []);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void (async () => {
      const result = await ask('threads');
      setThreads(result.threads);
      bumpRevision();
      if (result.error != null) onNotice(`Comments: ${result.error}`);
      else if (result.truncated) {
        onNotice('GitHub returned only the most recent comments on this pull request.');
      }
    })();
  }, [bumpRevision, onNotice]);

  const reload = useCallback(async (): Promise<void> => {
    const result = await ask('threads');
    setThreads(result.threads);
    bumpRevision();
    if (result.error != null) onNotice(`Comments: ${result.error}`);
  }, [bumpRevision, onNotice]);

  // Annotations live on the item, so hang each thread on the file it belongs to
  const withThreads = useMemo(() => {
    const all = draft == null ? threads : [...threads, draft];
    if (all.length === 0) return items;

    const byPath = new Map<string, ReviewThread[]>();
    for (const thread of all) {
      const list = byPath.get(thread.path);
      if (list == null) byPath.set(thread.path, [thread]);
      else list.push(thread);
    }

    return items.map((item) => {
      const list = byPath.get(item.fileDiff.name);
      if (list == null) return item;
      /**
       * Hiding clears the annotations rather than leaving the item alone: the
       * viewer redraws a file when its version moves, so a file that keeps the
       * conversations it was drawn with would keep showing them
       */
      if (hidden) return { ...item, annotations: [], version: (item.version ?? 0) + revision };
      return {
        ...item,
        annotations: list
          .map((thread) => ({
            side: thread.side,
            /** A comment on the file, or on lines that have since changed, goes to the top */
            lineNumber: thread.isOutdated || thread.line == null ? 0 : thread.line,
            metadata: thread,
          }))
          .toSorted((a, b) => a.lineNumber - b.lineNumber),
        version: (item.version ?? 0) + revision,
      };
    });
  }, [draft, hidden, items, revision, threads]);

  const toggleHidden = useCallback(() => {
    setComments(hidden ? 'show' : 'hide');
    setDraft(undefined);
    bumpRevision();
  }, [bumpRevision, hidden, setComments]);

  const openDraft = useCallback(
    (path: string, line: number, side: 'additions' | 'deletions') => {
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
      bumpRevision();
    },
    [bumpRevision],
  );

  const closeDraft = useCallback(() => {
    setDraft(undefined);
    bumpRevision();
  }, [bumpRevision]);

  const reply = useCallback(
    async (thread: ReviewThread, body: string): Promise<string | undefined> => {
      // A reply answers the first comment in the thread, as GitHub's own
      // client does
      const inReplyTo = thread.comments[0]?.databaseId ?? '';
      if (inReplyTo === '') return 'GitHub did not say which comment this conversation starts with.';
      const result = await ask('reply', { inReplyTo, path: thread.path, body });
      if (!result.ok) return result.error ?? 'GitHub refused the reply.';
      await reload();
      return undefined;
    },
    [reload],
  );

  const resolve = useCallback(
    async (thread: ReviewThread): Promise<string | undefined> => {
      const result = await ask('resolve', { threadId: thread.id, resolved: !thread.isResolved });
      if (!result.ok) return result.error ?? 'GitHub refused that.';
      await reload();
      return undefined;
    },
    [reload],
  );

  const edit = useCallback(
    async (comment: ReviewComment, body: string): Promise<string | undefined> => {
      const result = await ask('edit-comment', { databaseId: comment.databaseId, body });
      if (!result.ok) return result.error ?? 'GitHub refused the edit.';
      await reload();
      return undefined;
    },
    [reload],
  );

  const remove = useCallback(
    async (comment: ReviewComment): Promise<string | undefined> => {
      const result = await ask('delete-comment', { databaseId: comment.databaseId });
      if (!result.ok) return result.error ?? 'GitHub refused to delete it.';
      await reload();
      return undefined;
    },
    [reload],
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
      bumpRevision();
      await reload();
      return undefined;
    },
    [bumpRevision, reload],
  );

  return {
    items: withThreads,
    hidden,
    toggleHidden,
    openDraft,
    closeDraft,
    reply,
    resolve,
    edit,
    remove,
    post,
    reload,
  };
}
