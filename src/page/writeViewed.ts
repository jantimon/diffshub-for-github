/**
 * Ticking a file off, on GitHub.
 *
 * The counterpart to `readViewed`: this is what keeps the viewer's ticks and
 * GitHub's own Files-changed tab agreeing in both directions.
 */

import type { Result } from '@/bridge';
import { pullPath, type PullRequestRef } from '@/pullRequest';
import { WRITE_JSON } from '@/page/requests';

export async function writeViewed(ref: PullRequestRef, path: string, viewed: boolean): Promise<Result> {
  try {
    const response = await fetch(`${pullPath(ref)}/file_review`, {
      method: 'POST',
      credentials: 'include',
      headers: WRITE_JSON,
      body: JSON.stringify({ path, viewed: viewed ? 'viewed' : 'unviewed' }),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `GitHub answered ${response.status} for ${path}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
