import type { Result } from '@/bridge';
import { findForm, findFormEndingWith, submitForm } from '@/page/forms';
import { pullPath, type PullRequestRef } from '@/pullRequest';
import { refusal, WRITE_JSON } from '@/page/requests';

/**
 * Replying to a comment, and resolving a conversation.
 *
 * The two are not alike. Resolving has a JSON route that takes the thread id
 * and nothing else, so it reaches every conversation on the pull request.
 * Replying has no such route, so it submits the form GitHub itself rendered --
 * read the comment at the top of `forms.ts` for why a token cannot simply be
 * looked up.
 */

/**
 * Replies to a review comment.
 *
 * Every thread on the page has its own reply form, all of them posting to the
 * same `review_comment/create` action, so the right one is picked out by the
 * comment it answers. The form already carries the side, the three commit
 * oids, the path and the line. Only the text is ours.
 */
export async function replyToComment(pr: PullRequestRef, inReplyTo: string, body: string): Promise<Result> {
  const action = `${pullPath(pr)}/review_comment/create`;

  try {
    // A token is good for the action it was minted for rather than the copy
    // it came in, so the thread's own form is preferred and any other copy
    // will do, with the comment it answers set to the one being replied to
    const form =
      findForm(
        action,
        (candidate: HTMLFormElement) => new FormData(candidate).get('in_reply_to') === inReplyTo,
      ) ?? findFormEndingWith('/review_comment/create');
    if (form == null) {
      return { ok: false, error: 'GitHub did not offer a reply form on this page.' };
    }

    const result = await submitForm(form, { in_reply_to: inReplyTo, 'comment[body]': body });
    return result.ok ? { ok: true } : { ok: false, error: `GitHub answered ${result.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
  const route = resolved ? 'resolve_thread' : 'unresolve_thread';

  try {
    const response = await fetch(`${pullPath(pr)}/page_data/${route}`, {
      method: 'POST',
      credentials: 'include',
      headers: WRITE_JSON,
      body: JSON.stringify({ threadId }),
    });

    if (response.ok) return { ok: true };
    // GitHub says why in the body -- that the reader may not resolve this
    // conversation, or that somebody already has
    return { ok: false, error: (await refusal(response)) ?? `GitHub answered ${response.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
