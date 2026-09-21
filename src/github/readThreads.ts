import type { ReviewComment, ReviewThread } from '@/bridge';

/** GitHub serves forty threads a page and will not serve more than this many. */
const PAGE_LIMIT = 40;
const MAX_PAGES = 20;

interface Preview {
  id?: string;
  path?: string;
  line?: number | null;
  startLine?: number | null;
  diffSide?: string;
  subjectType?: string;
  isOutdated?: boolean;
}

interface Thread {
  id?: string;
  isResolved?: boolean;
  reviewCommentsLimitExceeded?: boolean;
  commentsData?: { comments?: RawComment[] };
}

interface RawComment {
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
}

/**
 * Reads the review threads on a pull request.
 *
 * Two of GitHub's own JSON routes, joined by thread id: `thread_previews` says
 * where each thread sits, `threads` carries the comments. Both page forty at a
 * time behind a `Link` header.
 *
 * The data the pull request page embeds is not a substitute: it stops at forty
 * threads, and it only anchors threads whose lines are still in the diff, so an
 * ordinary pull request with a few outdated comments loses most of them.
 */
export async function readThreads(
  owner: string,
  repo: string,
  number: number
): Promise<{ threads: ReviewThread[]; truncated: boolean; error?: string }> {
  const base = `/${owner}/${repo}/pull/${number}/page_data`;

  try {
    const [previews, threads] = await Promise.all([
      walk<Preview>(`${base}/thread_previews`),
      walk<Thread>(`${base}/threads`),
    ]);

    const bodies = new Map<string, Thread>();
    for (const thread of threads.items) {
      if (thread?.id != null) bodies.set(String(thread.id), thread);
    }

    const out: ReviewThread[] = [];
    for (const preview of previews.items) {
      const id = String(preview?.id ?? '');
      const path = String(preview?.path ?? '');
      if (id === '' || path === '') continue;

      const thread = bodies.get(id);
      out.push({
        id,
        path,
        // A comment on the file as a whole carries no line.
        line: preview?.subjectType === 'FILE' ? null : (preview?.line ?? null),
        side: preview?.diffSide === 'LEFT' ? 'deletions' : 'additions',
        isResolved: thread?.isResolved === true,
        isOutdated: preview?.isOutdated === true,
        comments: (thread?.commentsData?.comments ?? []).map(toComment),
      });
    }

    return { threads: out, truncated: previews.truncated || threads.truncated };
  } catch (error) {
    return {
      threads: [],
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toComment(comment: RawComment): ReviewComment {
  return {
    author: comment?.author?.login ?? 'someone',
    body: comment?.body ?? '',
    createdAt: comment?.createdAt ?? '',
    url: comment?.url ?? '',
  };
}

async function walk<T>(start: string): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | undefined = start;

  for (let page = 0; page < MAX_PAGES && url != null; page += 1) {
    const response: Response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for the comments.`);

    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) break;
    items.push(...(batch as T[]));

    url = nextPage(response.headers.get('link'));
    if (batch.length < PAGE_LIMIT) break;
  }

  return { items, truncated: url != null };
}

function nextPage(link: string | null): string | undefined {
  if (link == null) return undefined;
  return /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
}
