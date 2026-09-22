import type { Result } from '@/bridge';
import { findForm, findFormEndingWith, submitForm } from '@/page/forms';
import { pullPath, type PullRequestRef } from '@/pullRequest';
import { WRITE_JSON } from '@/page/requests';

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
 * oids, the path and the line; only the text is ours.
 */
export async function replyToComment(pr: PullRequestRef, inReplyTo: string, body: string): Promise<Result> {
  const action = `${pullPath(pr)}/review_comment/create`;

  try {
    // Every thread has its own copy of this one form, and a token is good for
    // the action it was minted for rather than the copy it came in. So the
    // thread's own form is preferred, and any other copy will do -- with the
    // comment it answers set to the one being replied to.
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
 * This used to submit the form GitHub rendered beside the conversation, which
 * limited it to the handful of threads the page underneath had materialised.
 * The JSON route needs only the id, which `readThreads` already has for every
 * conversation.
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
    // conversation, or that somebody already has.
    return { ok: false, error: (await reason(response)) ?? `GitHub answered ${response.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function reason(response: Response): Promise<string | undefined> {
  try {
    const said = (await response.json()) as { message?: string; error?: string };
    return said?.message ?? said?.error;
  } catch {
    return undefined;
  }
}
