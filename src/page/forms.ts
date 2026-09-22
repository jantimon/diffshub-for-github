/**
 * Submitting one of GitHub's own forms.
 *
 * Almost everything this extension asks GitHub to do goes through JSON routes
 * that need no credential beyond the session cookie. Replying to a comment is
 * the exception: it is an old-style Rails form post, and GitHub accepts it only
 * with an `authenticity_token`.
 *
 * There is no page-wide token to find. The token is scoped to a single form
 * action, and a pull request page carries dozens of hidden `authenticity_token`
 * inputs, every one holding a different value. Sending one to the wrong route
 * fails.
 *
 * GitHub's own code reads the token from the exact form it is submitting. From
 * its published source, `behaviors/commenting/preview.ts`:
 *
 *     container.closest<HTMLFormElement>('form')!.elements.namedItem('authenticity_token')
 *
 * This goes one step further and never handles the token at all: it takes the
 * whole form GitHub already rendered for that action, changes only what the
 * reader typed, and posts it back to the form's own action.
 *
 * So a token can only reach the route it was minted for -- sending it
 * elsewhere is not expressible here -- and no field name or commit sha is
 * invented, because GitHub fills in the side, the three commit oids, the path
 * and the line, and this carries them along untouched.
 *
 * Every reply form on the page posts to one shared `review_comment/create`
 * action, and a token is good for the action it was minted for rather than the
 * copy it arrived in. Rails masks each render differently, so two copies look
 * unalike while being equally valid. Any of them will do; the comment being
 * answered is set on it.
 *
 * All of this runs in the content script, on github.com's own origin. Tokens
 * never cross into the extension's viewer, and none is stored or logged.
 */

import { POST_FORM } from '@/page/requests';

/**
 * Finds a form by the action it ends with, for actions that are the same for
 * every instance -- a reply form, say, where each thread has its own copy of
 * one shared action. Rails masks a token differently every time it renders it,
 * so two copies look unalike while being equally valid for that action.
 */
export function findFormEndingWith(
  suffix: string,
  match?: (form: HTMLFormElement) => boolean,
): HTMLFormElement | undefined {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[action]')) {
    if (!(form.getAttribute('action') ?? '').endsWith(suffix)) continue;
    if (match == null || match(form)) return form;
  }
  return undefined;
}

/** Finds a form GitHub has already rendered, by the action it posts to */
export function findForm(
  action: string,
  match?: (form: HTMLFormElement) => boolean,
): HTMLFormElement | undefined {
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
  overrides: Record<string, string> = {},
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

/** Escapes a value for use inside an attribute selector */
function cssEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
