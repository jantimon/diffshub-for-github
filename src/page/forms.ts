/**
 * Submitting one of GitHub's own forms.
 *
 * ## Why this file exists
 *
 * Most of what this extension asks GitHub to do goes through JSON routes that
 * need no credential beyond the session cookie: fetching a patch, marking a
 * file viewed, writing a comment, submitting a review. Two actions are
 * different -- replying to a comment and resolving a conversation. Those are
 * old-style Rails form posts, and GitHub will only accept them with an
 * `authenticity_token`.
 *
 * ## Why we cannot simply find a token
 *
 * There is no page-wide token to find. `<meta name="csrf-token">` is long gone,
 * and the token is scoped to a single form action: a pull request page carries
 * dozens of hidden `authenticity_token` inputs and every one of them holds a
 * different value. A token taken from the "add a reaction" form will not
 * resolve a conversation. Sending one to the wrong route fails, and helping
 * yourself to whichever token is nearest is the kind of thing that works in
 * testing and breaks in front of a user.
 *
 * ## What GitHub itself does
 *
 * GitHub's own code reads the token from the exact form it is submitting.
 * From its published source, `behaviors/commenting/preview.ts`:
 *
 *     container.closest<HTMLFormElement>('form')!.elements.namedItem('authenticity_token')
 *
 * It also ships a lint rule, `github/authenticity-token`, that flags every
 * direct use of one, so each has to be justified where it is written. The
 * pattern GitHub intends is clear: a token belongs to a form, and travels
 * nowhere else.
 *
 * ## What this file does
 *
 * It goes one step further than reading the token out. It takes the whole form
 * GitHub already rendered for that action, copies every field, changes only
 * what the reader typed, and posts it back to the form's own action. That
 * means:
 *
 * - A token can only reach the route it was minted for, because the form is
 *   found by its action and posted to that same action. Sending a token
 *   somewhere else is not expressible here.
 * - No field name or commit sha is invented. GitHub fills in the eight or so
 *   values a reply needs -- the side, three commit oids, the path, the line --
 *   and this carries them along untouched. If GitHub renames one, the reply
 *   keeps working.
 * - The token is read at the moment of submitting, used once, and never
 *   stored, logged, or passed anywhere.
 *
 * All of this runs in the content script, on github.com's own origin. Tokens
 * never cross into the extension's viewer.
 *
 * ## When the form is not there
 *
 * These forms are built by React after the page loads, so fetching the page
 * again and reading its HTML finds nothing -- there is no server-rendered copy
 * to fall back on. What is available depends on the action:
 *
 * - Replies all post to one shared action, `review_comment/create`, and a
 *   token is good for the action it was minted for rather than the copy it
 *   arrived in. Rails masks each one differently, so two copies look unalike
 *   while being equally valid. Any reply form on the page will do; the comment
 *   being answered is set on it.
 * - Resolving posts to the thread's own address, so its token is good for that
 *   thread alone. Measured: a token from a reply form is refused with 422.
 *   Only that thread's form works, and when GitHub has not rendered one the
 *   reader is told rather than left wondering.
 *
 * GitHub also renders whichever transition applies -- resolve, or reopen --
 * never both. Taking the one it offers avoids acting on a stale idea of the
 * state, which is what our own copy becomes the moment we change it.
 */

import { POST_FORM } from '@/page/requests';

/**
 * Finds a form GitHub has already rendered, by any of the actions it might
 * post to.
 *
 * More than one action is useful where GitHub renders whichever transition is
 * available rather than both: a conversation shows a form to resolve it, or
 * one to reopen it, never the pair.
 */
export function findAnyForm(
  actions: string[],
  match?: (form: HTMLFormElement) => boolean
): HTMLFormElement | undefined {
  for (const action of actions) {
    const form = findForm(action, match);
    if (form != null) return form;
  }
  return undefined;
}

/**
 * Finds a form by the action it ends with, for actions that are the same for
 * every instance -- a reply form, say, where each thread has its own copy of
 * one shared action. Rails masks a token differently every time it renders it,
 * so two copies look unalike while being equally valid for that action.
 */
export function findFormEndingWith(
  suffix: string,
  match?: (form: HTMLFormElement) => boolean
): HTMLFormElement | undefined {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[action]')) {
    if (!(form.getAttribute('action') ?? '').endsWith(suffix)) continue;
    if (match == null || match(form)) return form;
  }
  return undefined;
}

/** Finds a form GitHub has already rendered, by the action it posts to. */
export function findForm(action: string, match?: (form: HTMLFormElement) => boolean): HTMLFormElement | undefined {
  for (const form of document.querySelectorAll<HTMLFormElement>(`form[action="${cssEscape(action)}"]`)) {
    if (match == null || match(form)) return form;
  }
  return undefined;
}

/**
 * Posts a form back to its own action, with some of its values replaced.
 *
 * `overrides` is what the reader actually changed -- the text of a reply, say.
 * Everything else, the token included, goes back exactly as GitHub wrote it.
 */
export async function submitForm(
  form: HTMLFormElement,
  overrides: Record<string, string> = {}
): Promise<{ ok: boolean; status: number }> {
  const body = new FormData(form);
  for (const [name, value] of Object.entries(overrides)) body.set(name, value);

  const response = await fetch(form.action, {
    method: 'POST',
    credentials: 'include',
    headers: POST_FORM,
    body,
  });

  return { ok: response.ok, status: response.status };
}

/** Escapes a value for use inside an attribute selector. */
function cssEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
