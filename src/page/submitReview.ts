import type { Result, ReviewEvent } from '@/bridge';
import { pullPath, type PullRequestRef } from '@/pullRequest';
import { refusal, WRITE_JSON } from '@/page/requests';

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
  body: string,
): Promise<Result> {
  try {
    const response = await fetch(`${pullPath(ref)}/page_data/submit_review`, {
      method: 'PUT',
      credentials: 'include',
      headers: WRITE_JSON,
      body: JSON.stringify({ body, event, headSha }),
    });

    if (response.ok) return { ok: true };
    return { ok: false, error: (await refusal(response)) ?? refusedWithout(response.status) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * What to tell the reader when GitHub refuses the review without saying why.
 *
 * 422 is worth naming: GitHub will not accept an approval of your own pull
 * request, and that is the refusal a reader is most likely to meet.
 */
function refusedWithout(status: number): string {
  if (status === 422) {
    return 'GitHub refused this review. The usual cause is approving your own pull request.';
  }
  return `GitHub answered ${status}.`;
}
