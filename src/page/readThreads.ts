/**
 * Reading every review comment on the pull request.
 *
 * GitHub serves forty threads a page behind a `Link` header. This follows that
 * up to `MAX_PAGES`, so a pull request with more than 800 threads is reported
 * as `truncated` rather than silently cut short or walked for ever.
 */

import type { ReviewComment, ReviewThread } from '@/shared/bridge';
import type { PullRequestRef } from '@/shared/pullRequest';
import { describeError } from '@/shared/errors';
import { readJson } from '@/page/client';
import { routes } from '@/page/routes';

const PAGE_LIMIT = 40;
const MAX_PAGES = 20;

interface Preview {
  id?: string;
  path?: string;
  line?: number | null;
  diffSide?: string;
  subjectType?: string;
  isOutdated?: boolean;
}

interface Thread {
  id?: string;
  isResolved?: boolean;
  resolvedBy?: string | null;
  viewerCanReply?: boolean;
  commentsData?: { comments?: RawComment[] };
}

interface RawComment {
  databaseId?: number | string;
  bodyHTML?: string;
  author?: { login?: string; avatarUrl?: string; isAgent?: boolean };
  authorAssociation?: string;
  lastUserContentEdit?: unknown;
  viewerCanUpdate?: boolean;
  viewerCanDelete?: boolean;
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
  ref: PullRequestRef,
): Promise<{ threads: ReviewThread[]; truncated: boolean; error?: string }> {
  try {
    const [previews, threads] = await Promise.all([
      walk<Preview>(routes.threadPreviews(ref)),
      walk<Thread>(routes.threads(ref)),
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
        /** A comment on the file as a whole carries no line */
        line: preview?.subjectType === 'FILE' ? null : (preview?.line ?? null),
        side: preview?.diffSide === 'LEFT' ? 'deletions' : 'additions',
        isResolved: thread?.isResolved === true,
        isOutdated: preview?.isOutdated === true,
        resolvedBy: thread?.resolvedBy ?? '',
        canReply: thread?.viewerCanReply !== false,
        comments: (thread?.commentsData?.comments ?? []).map(toComment),
      });
    }

    return { threads: out, truncated: previews.truncated || threads.truncated };
  } catch (error) {
    return {
      threads: [],
      truncated: false,
      error: describeError(error),
    };
  }
}

function toComment(comment: RawComment): ReviewComment {
  return {
    databaseId: String(comment?.databaseId ?? ''),
    author: comment?.author?.login ?? '',
    avatarUrl: comment?.author?.avatarUrl ?? '',
    isAgent: comment?.author?.isAgent === true,
    association: comment?.authorAssociation ?? '',
    isEdited: comment?.lastUserContentEdit != null,
    canEdit: comment?.viewerCanUpdate === true,
    canDelete: comment?.viewerCanDelete === true,
    body: comment?.body ?? '',
    bodyHTML: comment?.bodyHTML ?? '',
    createdAt: comment?.createdAt ?? '',
    url: comment?.url ?? '',
  };
}

async function walk<T>(start: string): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | undefined = start;

  for (let page = 0; page < MAX_PAGES && url != null; page += 1) {
    const { json: batch, response }: { json: unknown; response: Response } = await readJson(
      url,
      'the comments',
    );
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
