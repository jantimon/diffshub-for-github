import type { NewComment } from '@/bridge';

const HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
  'github-verified-fetch': 'true',
};

let comparison: Promise<{ baseOid: string; headOid: string }> | undefined;

/**
 * The commits the diff is taken between, which a new comment has to name.
 *
 * Read once and kept, and only when a comment is actually written: the route
 * carries the whole file list with it, which is over a megabyte on a large
 * pull request.
 */
function readComparison(base: string): Promise<{ baseOid: string; headOid: string }> {
  comparison ??= (async () => {
    const response = await fetch(`${base}/page_data/base_comparison_info`, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for the commit range.`);
    const payload = (await response.json()) as {
      pullRequest?: { comparison?: { baseOid?: string; headOid?: string } };
    };
    const { baseOid, headOid } = payload?.pullRequest?.comparison ?? {};
    if (baseOid == null || headOid == null) throw new Error('GitHub did not say which commits this diff spans.');
    return { baseOid, headOid };
  })();
  return comparison;
}

/**
 * Posts a review comment on one line.
 *
 * GitHub refuses a write that carries any origin but its own, so this runs in
 * the content script rather than the viewer.
 */
export async function writeComment(
  owner: string,
  repo: string,
  number: number,
  comment: NewComment
): Promise<{ ok: boolean; error?: string }> {
  const base = `/${owner}/${repo}/pull/${number}`;

  try {
    const { baseOid, headOid } = await readComparison(base);
    const side = comment.side === 'deletions' ? 'left' : 'right';

    const response = await fetch(`${base}/page_data/create_review_comment`, {
      method: 'POST',
      credentials: 'include',
      headers: HEADERS,
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) return { ok: false, error: `GitHub answered ${response.status}.` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
