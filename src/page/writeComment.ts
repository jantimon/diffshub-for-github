import type { NewComment, Result } from '@/shared/bridge';
import { pullPath, type PullRequestRef } from '@/shared/pullRequest';
import { failed, readJson, writeJson } from '@/page/client';
import { routes } from '@/page/routes';

let comparison: { base: string; oids: Promise<{ baseOid: string; headOid: string }> } | undefined;

/**
 * The commits the diff is taken between, which a new comment has to name.
 *
 * Read only when a comment is actually written, and kept afterwards: the route
 * carries the whole file list with it, which is over a megabyte on a large
 * pull request.
 *
 * Kept against the pull request it was read for. The content script stays alive
 * across GitHub's client-side navigation, so without that a comment written on
 * the second pull request of a visit would name the first one's commits.
 */
function readComparison(ref: PullRequestRef): Promise<{ baseOid: string; headOid: string }> {
  const base = pullPath(ref);
  if (comparison?.base !== base) {
    comparison = {
      base,
      oids: (async () => {
        const { json: payload } = await readJson<{
          pullRequest?: { comparison?: { baseOid?: string; headOid?: string } };
        }>(routes.baseComparison(ref), 'the commit range');
        const { baseOid, headOid } = payload?.pullRequest?.comparison ?? {};
        if (baseOid == null || headOid == null)
          throw new Error('GitHub did not say which commits this diff spans.');
        return { baseOid, headOid };
      })(),
    };
  }
  return comparison.oids;
}

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
