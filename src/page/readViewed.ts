/**
 * Which files GitHub already has marked as viewed.
 *
 * One request, and it reports the state rather than changing anything: the
 * file-filter menu on GitHub's own page would persist the setting server side.
 */

import type { PullRequestRef } from '@/shared/pullRequest';
import { describeError } from '@/shared/errors';
import { readJson } from '@/page/client';
import { routes } from '@/page/routes';

export async function readViewed(
  ref: PullRequestRef,
): Promise<{ paths: string[]; baseSha?: string; error?: string }> {
  try {
    const { json: payload } = await readJson<{
      baseRefOid?: string;
      diffs?: { path?: string; markedAsViewed?: boolean | null }[];
    }>(routes.fileTree(ref), 'the file list');

    return {
      paths: (payload?.diffs ?? [])
        .filter((file) => file?.markedAsViewed === true)
        .flatMap((file) => (file.path == null ? [] : [file.path])),
      baseSha: payload?.baseRefOid,
    };
  } catch (error) {
    return { paths: [], error: describeError(error) };
  }
}
