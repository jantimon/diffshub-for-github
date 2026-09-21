export type ReviewEvent = 'comment' | 'approve' | 'request changes';

/**
 * Submits a review: a verdict and a covering note.
 *
 * `headSha` is what the review is recorded against, so a review submitted
 * after a push does not claim to cover commits nobody read.
 */
export async function submitReview(
  owner: string,
  repo: string,
  number: number,
  headSha: string,
  event: ReviewEvent,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/${owner}/${repo}/pull/${number}/page_data/submit_review`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'github-verified-fetch': 'true',
      },
      body: JSON.stringify({ body, event, headSha }),
    });

    if (response.ok) return { ok: true };
    // GitHub refuses to let you approve your own pull request, among others.
    const said = await response.text();
    const reason = /"message"\s*:\s*"([^"]+)"/.exec(said)?.[1];
    return { ok: false, error: reason ?? `GitHub answered ${response.status}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
