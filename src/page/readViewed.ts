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
import { FileTree } from '@/page/shapes';

export async function readViewed(
  ref: PullRequestRef,
): Promise<{ paths: string[]; baseSha?: string; error?: string }> {
  try {
    const { json: tree } = await readJson(routes.fileTree(ref), 'the file list', FileTree);
    return {
      paths: tree.diffs.filter((file) => file.markedAsViewed === true).map((file) => file.path),
      baseSha: tree.baseRefOid ?? undefined,
    };
  } catch (error) {
    return { paths: [], error: describeError(error) };
  }
}
