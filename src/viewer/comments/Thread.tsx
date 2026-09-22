import { useState } from 'react';

import { MarkdownEditor } from '@/viewer/comments/MarkdownEditor';

import type { ReviewComment, ReviewThread } from '@/bridge';

/**
 * GitHub's own rendering of a comment, which is the only way a suggested change
 * arrives as anything but raw markdown. GitHub sanitises it, and the extension's
 * content security policy allows no inline script, so nothing in it can run.
 */
function CommentBody({ comment }: { comment: ReviewComment }) {
  if (comment.bodyHTML === '') return <p>{comment.body}</p>;
  return <div className="dh-comment-body" dangerouslySetInnerHTML={{ __html: comment.bodyHTML }} />;
}

/** One review thread, at the line it was left on */
export function Thread({
  thread,
  onReply,
  onResolve,
}: {
  thread: ReviewThread;
  onReply: (body: string) => Promise<string | undefined>;
  onResolve: () => Promise<string | undefined>;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const labels = [
    thread.isResolved ? 'Resolved' : undefined,
    thread.isOutdated ? 'Outdated' : undefined,
    thread.line == null ? 'On the file' : undefined,
  ].filter(Boolean);

  const run = async (work: () => Promise<string | undefined>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const failed = await work();
    setBusy(false);
    if (failed != null) setError(failed);
  };

  return (
    <aside className="dh-thread" data-resolved={thread.isResolved}>
      {labels.length > 0 && <p className="dh-thread-resolved">{labels.join(' · ')}</p>}

      {thread.comments.map((comment) => (
        <article className="dh-comment" key={comment.databaseId}>
          <header>
            {comment.author !== '' && <strong>{comment.author}</strong>}
            {comment.createdAt !== '' && (
              <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString()}</time>
            )}
            {comment.url !== '' && (
              <a href={comment.url} target="_top">
                Open on GitHub
              </a>
            )}
          </header>
          <CommentBody comment={comment} />
        </article>
      ))}

      {error != null && <p className="dh-thread-error">{error}</p>}

      {replying ? (
        <div className="dh-composer">
          <MarkdownEditor
            value={text}
            onChange={setText}
            placeholder="Reply"
            rows={3}
            disabled={busy}
            focusOnMount
            onSubmit={() =>
              void run(async () => {
                const failed = await onReply(text);
                if (failed == null) {
                  setText('');
                  setReplying(false);
                }
                return failed;
              })
            }
          />
          <div className="dh-composer-actions">
            <button type="button" onClick={() => setReplying(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="dh-composer-send"
              disabled={busy || text.trim() === ''}
              onClick={() =>
                void run(async () => {
                  const failed = await onReply(text);
                  if (failed == null) {
                    setText('');
                    setReplying(false);
                  }
                  return failed;
                })
              }
            >
              {busy ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dh-thread-actions">
          <button type="button" data-dh-thread="reply" disabled={busy} onClick={() => setReplying(true)}>
            Reply
          </button>
          <button
            type="button"
            data-dh-thread="resolve"
            disabled={busy}
            onClick={() => void run(() => onResolve())}
          >
            {thread.isResolved ? 'Reopen conversation' : 'Resolve conversation'}
          </button>
        </div>
      )}
    </aside>
  );
}
