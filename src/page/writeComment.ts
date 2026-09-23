import type { NewComment, Result } from '@/shared/bridge';
import type { PullRequestRef } from '@/shared/pullRequest';
import { failed, writeJson } from '@/page/client';
import { readComparison } from '@/page/comparison';
import { routes } from '@/page/routes';

/**
 * Posts a review comment on one line.
 *
 * GitHub refuses a write that carries any origin but its own, so this runs in
 * the content script rather than the viewer.
 */
export async function writeComment(ref: PullRequestRef, comment: NewComment): Promise<Result> {
  try {
    const { baseOid, headOid } = await readComparison(ref);
    const side = comment.side === 'deletions' ? 'left' : 'right';

    return await writeJson(routes.createComment(ref), 'POST', {
      comparisonStartOid: baseOid,
      comparisonEndOid: headOid,
      text: comment.text,
      submitBatch: true,
      line: comment.line,
      path: comment.path,
      positioning: {
        type: 'line',
        baseCommitOid: baseOid,
        headCommitOid: headOid,
        path: comment.path,
        line: comment.line,
        commitOid: headOid,
      },
      side,
      subjectType: 'line',
    });
  } catch (error) {
    return failed(error);
  }
}
