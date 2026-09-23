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

export async function writeViewed(ref: PullRequestRef, path: string, viewed: boolean): Promise<Result> {
  return await writeJson(
    routes.fileReview(ref),
    'POST',
    { path, viewed: viewed ? 'viewed' : 'unviewed' },
    (status) => `GitHub answered ${status} for ${path}.`,
  );
}
