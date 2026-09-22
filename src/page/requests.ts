/**
 * The headers GitHub's own page sends, and which its routes expect.
 *
 * `x-requested-with` is what marks a request as coming from inside a page
 * rather than from a typed-in address; without it the JSON routes answer with
 * HTML. `github-verified-fetch` is the extra header GitHub's client puts on its
 * JSON writes, and the write routes refuse a request that lacks it.
 *
 * Every request also carries `credentials: 'include'`, which is what makes the
 * reader's own session the thing acting. No token is held anywhere.
 */

/** Reading one of the `page_data` routes */
export const READ_JSON = {
  accept: 'application/json',
  'x-requested-with': 'XMLHttpRequest',
};

/** Writing through one of the `page_data` routes */
export const WRITE_JSON = {
  accept: 'application/json',
  'content-type': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
  'github-verified-fetch': 'true',
};

/**
 * Posting one of GitHub's rendered forms. The body is a `FormData`, so the
 * content type is left to the browser, which has to add the multipart boundary.
 */
export const POST_FORM = {
  'x-requested-with': 'XMLHttpRequest',
};

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

  try {
    const body = JSON.parse(said) as {
      message?: string;
      error?: string;
      errors?: { message?: string }[];
    };
    return body.message ?? body.error ?? body.errors?.find((one) => one.message != null)?.message;
  } catch {
    return undefined;
  }
}
