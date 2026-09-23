import type { Result } from '@/shared/bridge';
import { readComparison } from '@/page/comparison';
import type { PullRequestRef } from '@/shared/pullRequest';
import { failed, writeJson } from '@/page/client';
import { routes } from '@/page/routes';

/**
 * Replying to a comment, resolving a conversation, and editing or deleting
 * the reader's own comments: each one JSON write to a `page_data` route
 */

/**
 * Replies to a review comment.
 *
 * The same route as a new comment, naming the comment it answers by its
 * database id, with the thread's file and the two commits the diff spans.
 * GitHub files the reply in that comment's thread.
 */
export async function replyToComment(
  pr: PullRequestRef,
  inReplyTo: string,
  path: string,
  body: string,
): Promise<Result> {
  try {
    const { baseOid, headOid } = await readComparison(pr);
    return await writeJson(routes.createComment(pr), 'POST', {
      text: body,
      inReplyTo: Number(inReplyTo),
      submitBatch: true,
      path,
      comparisonStartOid: baseOid,
      comparisonEndOid: headOid,
    });
  } catch (error) {
    return failed(error);
  }
}

/**
 * Resolves a conversation, or reopens one.
 *
 * `resolved` is the state being asked for, not a toggle: GitHub has separate
 * routes for the two directions, and our idea of the current state goes stale
 * the moment anyone else acts on the thread.
 *
 * The JSON route needs only the id, which `readThreads` has for every
 * conversation. A form would do instead, but only for the few threads the page
 * underneath has rendered.
 */
export async function resolveThread(
  pr: PullRequestRef,
  threadId: string,
  resolved: boolean,
): Promise<Result> {
  return await writeJson(routes.resolveThread(pr, resolved), 'POST', { threadId });
}

/**
 * Rewrites one of the reader's own comments.
 *
 * `commentId` is the comment's database id, sent as a string. The node id
 * GitHub also hands out answers 404 here, although the route's own type calls
 * the field a string.
 */
export async function editComment(pr: PullRequestRef, databaseId: string, body: string): Promise<Result> {
  return await writeJson(routes.updateComment(pr), 'PUT', { body, commentId: databaseId });
}

/**
 * Takes one of the reader's own comments down.
 *
 * GitHub's own client no longer names this route, yet the server still
 * answers it. It is the likeliest of the routes here to go, so a refusal is
 * reported as it comes rather than smoothed over.
 */
export async function deleteComment(pr: PullRequestRef, databaseId: string): Promise<Result> {
  return await writeJson(routes.deleteComment(pr, databaseId), 'DELETE');
}
