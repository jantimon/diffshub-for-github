import type { Result } from '@/bridge';
import { findAnyForm, findForm, findFormEndingWith, submitForm } from '@/page/forms';
import { pullPath, type PullRequestRef } from '@/pullRequest';

/**
 * Replying to a comment and resolving a conversation.
 *
 * Both are form posts rather than the JSON routes the rest of this extension
 * uses, so both go through `formActions`, which submits the form GitHub itself
 * rendered. Read the comment at the top of that file first -- it explains why
 * a token cannot simply be looked up.
 */

/**
 * Replies to a review comment.
 *
 * Every thread on the page has its own reply form, all of them posting to the
 * same `review_comment/create` action, so the right one is picked out by the
 * comment it answers. The form already carries the side, the three commit
 * oids, the path and the line; only the text is ours.
 */
export async function replyToComment(
  pr: PullRequestRef,
  inReplyTo: string,
  body: string
): Promise<Result> {
  const action = `${pullPath(pr)}/review_comment/create`;

  try {
    // Every thread has its own copy of this one form, and a token is good for
    // the action it was minted for rather than the copy it came in. So the
    // thread's own form is preferred, and any other copy will do -- with the
    // comment it answers set to the one being replied to.
    const form =
      findForm(action, (candidate: HTMLFormElement) => new FormData(candidate).get('in_reply_to') === inReplyTo) ??
      findFormEndingWith('/review_comment/create');
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
 * The form posts to the thread's own address and carries `_method=put`, which
 * is how Rails spells a PUT through an HTML form. Nothing here needs changing:
 * the form as rendered is the whole request.
 */
export async function resolveThread(
  pr: PullRequestRef,
  threadId: string
): Promise<Result> {
  const base = `${pullPath(pr)}/threads/${threadId}`;

  try {
    // Unlike a reply, these tokens are tied to the thread's own address, so no
    // other form will do. GitHub renders whichever transition is available --
    // resolve, or reopen -- and that is the one to take: our own idea of the
    // state goes stale the moment we change it.
    const form = findAnyForm([`${base}/resolve`, `${base}/unresolve`]);
    if (form == null) {
      return {
        ok: false,
        error: 'GitHub has not loaded that conversation on this page, so it cannot be resolved from here yet.',
      };
    }

    const result = await submitForm(form);
    return result.ok ? { ok: true } : { ok: false, error: `GitHub answered ${result.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
