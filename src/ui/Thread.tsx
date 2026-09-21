import { useState } from 'react';

import type { ReviewThread } from '@/bridge';

/** One review thread, at the line it was left on. */
export function Thread({
  thread,
  onReply,
  onResolve,
}: {
  thread: ReviewThread;
  onReply: (body: string) => Promise<string | undefined>;
  onResolve: (resolved: boolean) => Promise<string | undefined>;
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

      {thread.comments.map((comment, index) => (
        <article className="dh-comment" key={`${thread.id}-${index}`}>
          <header>
            <strong>{comment.author}</strong>
            {comment.createdAt !== '' && (
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleDateString()}
              </time>
            )}
            {comment.url !== '' && (
              <a href={comment.url} target="_top">
                Open on GitHub
              </a>
            )}
          </header>
          <p>{comment.body}</p>
        </article>
      ))}

      {error != null && <p className="dh-thread-error">{error}</p>}

      {replying ? (
        <div className="dh-composer">
          <textarea
            className="dh-composer-text"
            rows={3}
            value={text}
            placeholder="Reply"
            disabled={busy}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setReplying(false);
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void run(async () => {
                  const failed = await onReply(text);
                  if (failed == null) {
                    setText('');
                    setReplying(false);
                  }
                  return failed;
                });
              }
            }}
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
            onClick={() => void run(() => onResolve(!thread.isResolved))}
          >
            {thread.isResolved ? 'Reopen conversation' : 'Resolve conversation'}
          </button>
        </div>
      )}
    </aside>
  );
}
