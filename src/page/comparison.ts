import { pullPath, type PullRequestRef } from '@/shared/pullRequest';
import { readJson } from '@/page/client';
import { routes } from '@/page/routes';
import { BaseComparison } from '@/page/shapes';

let comparison: { base: string; oids: Promise<{ baseOid: string; headOid: string }> } | undefined;

/**
 * The commits the diff is taken between, which a new comment or a reply has to
 * name.
 *
 * Read only when a comment is actually written, and kept afterwards: the route
 * carries the whole file list with it, which is over a megabyte on a large
 * pull request.
 *
 * Kept against the pull request it was read for. The content script stays alive
 * across GitHub's client-side navigation, so without that a comment written on
 * the second pull request of a visit would name the first one's commits.
 */
export function readComparison(ref: PullRequestRef): Promise<{ baseOid: string; headOid: string }> {
  const base = pullPath(ref);
  if (comparison?.base !== base) {
    comparison = {
      base,
      oids: (async () => {
        const { json } = await readJson(routes.baseComparison(ref), 'the commit range', BaseComparison);
        return json.pullRequest.comparison;
      })(),
    };
  }
  return comparison.oids;
}
