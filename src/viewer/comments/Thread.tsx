import { useState } from 'react';

import { MarkdownEditor } from '@/viewer/comments/MarkdownEditor';

import type { ReviewComment, ReviewThread } from '@/bridge';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const EXACT = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' });

/**
 * How long ago a comment was left.
 *
 * A review is read as a conversation, where "3 days ago" places a remark
 * against the others far better than a date does. The date is still there, on
 * the element's title.
 */
function when(iso: string): { label: string; title: string } | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;

  const gap = at.getTime() - Date.now();
  const size = Math.abs(gap);
  const [amount, unit] =
    size < HOUR
      ? [gap / MINUTE, 'minute' as const]
      : size < DAY
        ? [gap / HOUR, 'hour' as const]
        : [gap / DAY, 'day' as const];

  return { label: RELATIVE.format(Math.round(amount), unit), title: EXACT.format(at) };
}

/**
 * `MEMBER` as GitHub writes it, `Member` as it is read.
 *
 * Every field a comment carries is checked here rather than trusted, because
 * the bridge is a boundary between two scripts that are not always the same
 * age: after an update the viewer is new while the content script already in
 * the page is the one from before, and it sends what it knew about then
 */
function association(value: string | undefined): string | undefined {
  if (value == null || value === '' || value === 'NONE') return undefined;
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * GitHub's own rendering of a comment, which is the only way a suggested change
 * arrives as anything but raw markdown. GitHub sanitises it, and the extension's
 * content security policy allows no inline script, so nothing in it can run.
 */
function CommentBody({ comment }: { comment: ReviewComment }) {
  if (comment.bodyHTML === '') return <p className="dh-markdown">{comment.body}</p>;
  return <div className="dh-markdown" dangerouslySetInnerHTML={{ __html: comment.bodyHTML }} />;
}

function Comment({ comment }: { comment: ReviewComment }) {
  const left = when(comment.createdAt);
  const badge = association(comment.association);
  const avatarUrl = comment.avatarUrl ?? '';

  return (
    <article className="dh-comment">
      <header className="dh-comment-head">
        <span className="dh-avatar">
          {avatarUrl === '' ? (
            <span aria-hidden="true" />
          ) : (
            <img src={avatarUrl} alt="" width={26} height={26} />
          )}
        </span>
        {comment.author !== '' && <strong>{comment.author}</strong>}
        {comment.isAgent && <span className="dh-badge">bot</span>}
        {badge != null && <span className="dh-badge">{badge}</span>}
        {left != null && (
          <time dateTime={comment.createdAt} title={left.title}>
            {left.label}
          </time>
        )}
        {comment.isEdited && <span className="dh-comment-edited">edited</span>}
        {comment.url !== '' && (
          <a href={comment.url} target="_top" title="Open this comment on GitHub">
            GitHub
          </a>
        )}
      </header>
      <CommentBody comment={comment} />
    </article>
  );
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

  /**
   * A comment on the file, or on lines that have since changed, is drawn above
   * the first hunk, where there is no line for the tail to point at
   */
  const onALine = !thread.isOutdated && thread.line != null;

  const labels = [
    thread.isResolved
      ? thread.resolvedBy == null || thread.resolvedBy === ''
        ? 'Resolved'
        : `Resolved by ${thread.resolvedBy}`
      : undefined,
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

  const sendReply = (): void =>
    void run(async () => {
      const failed = await onReply(text);
      if (failed == null) {
        setText('');
        setReplying(false);
      }
      return failed;
    });

  return (
    <aside
      className="dh-thread"
      data-resolved={thread.isResolved}
      data-side={thread.side}
      data-tail={onALine ? 'line' : 'none'}
    >
      {labels.length > 0 && <p className="dh-thread-resolved">{labels.join(' · ')}</p>}

      {thread.comments.map((comment) => (
        <Comment comment={comment} key={comment.databaseId} />
      ))}

      {error != null && <p className="dh-thread-error">{error}</p>}

      {replying ? (
        <div className="dh-composer dh-composer-reply">
          <MarkdownEditor
            value={text}
            onChange={setText}
            placeholder="Reply"
            rows={3}
            disabled={busy}
            focusOnMount
            onSubmit={sendReply}
          />
          <div className="dh-composer-actions">
            <button type="button" onClick={() => setReplying(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="dh-composer-send"
              disabled={busy || text.trim() === ''}
              onClick={sendReply}
            >
              {busy ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dh-thread-actions">
          <button
            type="button"
            data-dh-thread="reply"
            disabled={busy || thread.canReply === false}
            title={
              thread.canReply === false ? 'GitHub is not taking replies on this conversation' : undefined
            }
            onClick={() => setReplying(true)}
          >
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
