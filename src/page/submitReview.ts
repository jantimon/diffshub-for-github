import type { Result, ReviewEvent } from '@/shared/bridge';
import type { PullRequestRef } from '@/shared/pullRequest';
import { writeJson } from '@/page/client';
import { routes } from '@/page/routes';

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
  return await writeJson(routes.submitReview(ref), 'PUT', { body, event, headSha }, refusedWithout);
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
