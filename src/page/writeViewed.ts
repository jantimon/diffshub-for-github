/**
 * Ticking a file off, on GitHub.
 *
 * The counterpart to `readViewed`: this is what keeps the viewer's ticks and
 * GitHub's own Files-changed tab agreeing in both directions.
 */

import type { Result } from '@/shared/bridge';
import type { PullRequestRef } from '@/shared/pullRequest';
import { writeJson } from '@/page/client';
import { routes } from '@/page/routes';

/**
 * Marking is a POST and unmarking a DELETE, as GitHub's own client sends them.
 * A POST saying `unviewed` is answered 200 and changes nothing, so a status
 * alone does not prove an unmark: the review suite reads the state back
 */
export async function writeViewed(ref: PullRequestRef, path: string, viewed: boolean): Promise<Result> {
  const refused = (status: number): string => `GitHub answered ${status} for ${path}.`;
  if (viewed) return await writeJson(routes.fileReview(ref), 'POST', { path, viewed: 'viewed' }, refused);
  return await writeJson(routes.fileReview(ref), 'DELETE', { path, _method: 'delete' }, refused);
}
