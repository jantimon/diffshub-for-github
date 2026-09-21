import type { ReviewThread } from '@/bridge';

/** One review thread, at the line it was left on. */
export function Thread({ thread }: { thread: ReviewThread }) {
  return (
    <aside className="dh-thread" data-resolved={thread.isResolved}>
      {(thread.isResolved || thread.isOutdated || thread.line == null) && (
        <p className="dh-thread-resolved">
          {[
            thread.isResolved ? 'Resolved' : undefined,
            thread.isOutdated ? 'Outdated' : undefined,
            thread.line == null ? 'On the file' : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
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
    </aside>
  );
}
