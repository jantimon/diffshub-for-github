import { fetchForm, findForm, submitForm } from './formActions';

/**
 * Replying to a comment and resolving a conversation.
 *
 * Both are form posts rather than the JSON routes the rest of this extension
 * uses, so both go through `formActions`, which submits the form GitHub itself
 * rendered. Read the comment at the top of that file first -- it explains why
 * a token cannot simply be looked up.
 */

interface PullRequest {
  owner: string;
  repo: string;
  number: number;
}

function pageUrl(pr: PullRequest): string {
  return `/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

/**
 * Replies to a review comment.
 *
 * Every thread on the page has its own reply form, all of them posting to the
 * same `review_comment/create` action, so the right one is picked out by the
 * comment it answers. The form already carries the side, the three commit
 * oids, the path and the line; only the text is ours.
 */
export async function replyToComment(
  pr: PullRequest,
  inReplyTo: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const action = `${pageUrl(pr)}/review_comment/create`;
  const isTheRightThread = (form: HTMLFormElement): boolean =>
    new FormData(form).get('in_reply_to') === inReplyTo;

  try {
    const form =
      findForm(action, isTheRightThread) ?? (await fetchForm(pageUrl(pr), action, isTheRightThread));
    if (form == null) {
      return { ok: false, error: 'GitHub did not offer a reply form for that comment.' };
    }

    const result = await submitForm(form, { 'comment[body]': body });
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
  pr: PullRequest,
  threadId: string,
  resolved: boolean
): Promise<{ ok: boolean; error?: string }> {
  const action = `${pageUrl(pr)}/threads/${threadId}/${resolved ? 'resolve' : 'unresolve'}`;

  try {
    const form = findForm(action) ?? (await fetchForm(pageUrl(pr), action));
    if (form == null) {
      return {
        ok: false,
        error: `GitHub did not offer a form to ${resolved ? 'resolve' : 'reopen'} that conversation.`,
      };
    }

    const result = await submitForm(form);
    return result.ok ? { ok: true } : { ok: false, error: `GitHub answered ${result.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
