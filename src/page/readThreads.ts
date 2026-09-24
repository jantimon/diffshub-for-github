/**
 * Reading every review comment on the pull request.
 *
 * GitHub serves forty threads a page behind a `Link` header. This follows that
 * up to `MAX_PAGES`, so a pull request with more than 800 threads is reported
 * as `truncated` rather than silently cut short or walked for ever.
 */

import type * as v from 'valibot';

import type { ReviewComment, ReviewThread } from '@/shared/bridge';
import type { PullRequestRef } from '@/shared/pullRequest';
import { describeError } from '@/shared/errors';
import { readJson } from '@/page/client';
import { routes } from '@/page/routes';
import { ThreadPage, ThreadPreviewPage, type ThreadComment } from '@/page/shapes';

const PAGE_LIMIT = 40;
const MAX_PAGES = 20;

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
      walk(routes.threadPreviews(ref), ThreadPreviewPage),
      walk(routes.threads(ref), ThreadPage),
    ]);

    const bodies = new Map(threads.items.map((thread) => [thread.id, thread]));

    const out: ReviewThread[] = previews.items.map((preview) => {
      const thread = bodies.get(preview.id);
      return {
        id: preview.id,
        path: preview.path,
        /** A comment on the file as a whole carries no line */
        line: preview.subjectType === 'FILE' ? null : (preview.line ?? null),
        side: preview.diffSide === 'LEFT' ? 'deletions' : 'additions',
        isResolved: thread?.isResolved === true,
        isOutdated: preview.isOutdated === true,
        resolvedBy: thread?.resolvedBy ?? '',
        canReply: thread?.viewerCanReply !== false,
        comments: (thread?.commentsData.comments ?? []).map(toComment),
      };
    });

    return { threads: out, truncated: previews.truncated || threads.truncated };
  } catch (error) {
    return {
      threads: [],
      truncated: false,
      error: describeError(error),
    };
  }
}

function toComment(comment: v.InferOutput<typeof ThreadComment>): ReviewComment {
  return {
    databaseId: comment.databaseId,
    author: comment.author?.login ?? '',
    avatarUrl: comment.author?.avatarUrl ?? '',
    isAgent: comment.author?.isAgent === true,
    association: comment.authorAssociation ?? '',
    isEdited: comment.lastUserContentEdit != null,
    canEdit: comment.viewerCanUpdate === true,
    canDelete: comment.viewerCanDelete === true,
    body: comment.body ?? '',
    bodyHTML: comment.bodyHTML ?? '',
    createdAt: comment.createdAt ?? '',
    url: comment.url ?? '',
  };
}

async function walk<T>(
  start: string,
  page: v.GenericSchema<unknown, T[]>,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | undefined = start;

  for (let count = 0; count < MAX_PAGES && url != null; count += 1) {
    const { json: list, response } = await readJson(url, 'the comments', page);
    items.push(...list);

    url = nextPage(response.headers.get('link'));
    if (list.length < PAGE_LIMIT) break;
  }

  return { items, truncated: url != null };
}

function nextPage(link: string | null): string | undefined {
  if (link == null) return undefined;
  return /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
}
