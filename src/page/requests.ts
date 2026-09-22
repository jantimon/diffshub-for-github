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
