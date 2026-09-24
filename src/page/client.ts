/**
 * Talking to GitHub's own routes, as the page does: with the reader's session,
 * GitHub's own headers (`headers.ts`), and GitHub's own reason when it refuses
 */

import * as v from 'valibot';

import { READ_JSON, WRITE_JSON } from '@/page/headers';
import { mismatch, Refusal } from '@/page/githubApiSchemas';
import type { Result } from '@/shared/bridge';
import { describeError } from '@/shared/errors';

/**
 * What GitHub said was wrong with a request it refused.
 *
 * Its refusals come back in more than one shape, and a route that does not
 * exist answers with an HTML error page carrying nothing useful. A bare status
 * number tells the reader nothing they can act on, so this digs out a sentence
 * where there is one and says so when there is not.
 */
export async function refusal(response: Response): Promise<string | undefined> {
  let said: string;
  try {
    said = await response.text();
  } catch {
    return undefined;
  }

  if (said.trimStart().startsWith('<')) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(said);
  } catch {
    return undefined;
  }
  const parsed = v.safeParse(Refusal, json);
  if (!parsed.success) return undefined;
  const { message, error, errors } = parsed.output;
  return message ?? error ?? errors?.find((one) => one.message != null)?.message ?? undefined;
}

/**
 * Reads one of the `page_data` routes and checks the answer against `schema`
 * (`githubApiSchemas.ts`). Throws with a sentence for the reader: GitHub's own reason
 * when it refuses, and when the answer is not JSON or no longer fits, which
 * field changed, since that means GitHub has changed the route
 */
export async function readJson<S extends v.GenericSchema>(
  url: string,
  what: string,
  schema: S,
): Promise<{ json: v.InferOutput<S>; response: Response }> {
  const response = await fetch(url, { credentials: 'include', headers: READ_JSON });
  if (!response.ok)
    throw new Error((await refusal(response)) ?? `GitHub answered ${response.status} for ${what}.`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(`GitHub's answer for ${what} was not JSON. GitHub may have changed the route.`);
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    throw new Error(
      `GitHub's answer for ${what} has changed (${mismatch(parsed.issues)}), so this extension cannot read it.`,
    );
  }
  return { json: parsed.output, response };
}

/**
 * One JSON write to a `page_data` route. GitHub says why it refused in the body
 * -- that the reader may not do this, or that somebody already has -- and that
 * sentence is what reaches the reader. `refused` words a refusal that came
 * without one
 */
export async function writeJson(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  refused: (status: number) => string = (status) => `GitHub answered ${status}.`,
): Promise<Result> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: WRITE_JSON,
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: (await refusal(response)) ?? refused(response.status) };
  } catch (error) {
    return failed(error);
  }
}

/** A request that threw, as a reply the viewer can show */
export function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: describeError(error) };
}
