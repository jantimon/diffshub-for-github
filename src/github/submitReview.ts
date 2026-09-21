import type { Result, ReviewEvent } from '@/bridge';
import { pullPath, type PullRequestRef } from './pr';
import { WRITE_JSON } from './requests';

/**
 * Submits a review: a verdict and a covering note.
 *
 * `headSha` is what the review is recorded against, so a review submitted
 * after a push does not claim to cover commits nobody read.
 */
export async function submitReview(
  ref: PullRequestRef,
  headSha: string,
  event: ReviewEvent,
  body: string
): Promise<Result> {
  try {
    const response = await fetch(`${pullPath(ref)}/page_data/submit_review`, {
      method: 'PUT',
      credentials: 'include',
      headers: WRITE_JSON,
      body: JSON.stringify({ body, event, headSha }),
    });

    if (response.ok) return { ok: true };
    // GitHub refuses to let you approve your own pull request, among others,
    // and says why in the body. Passing its reason on beats a bare status.
    return { ok: false, error: (await reason(response)) ?? `GitHub answered ${response.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function reason(response: Response): Promise<string | undefined> {
  try {
    const said = (await response.json()) as { message?: string };
    return said?.message;
  } catch {
    return undefined;
  }
}
