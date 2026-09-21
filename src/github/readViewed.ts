/**
 * Which files GitHub already has marked as viewed.
 *
 * One request, and it reports the state rather than changing anything: the
 * file-filter menu on GitHub's own page would persist the setting server side.
 */

import { pullPath, type PullRequestRef } from './pr';
import { READ_JSON } from './requests';

export async function readViewed(
  ref: PullRequestRef
): Promise<{ paths: string[]; baseSha?: string; error?: string }> {
  try {
    const response = await fetch(`${pullPath(ref)}/page_data/file_tree`, {
      credentials: 'include',
      headers: READ_JSON,
    });
    if (!response.ok) return { paths: [], error: `GitHub answered ${response.status} for the file list.` };

    const payload = (await response.json()) as {
      baseRefOid?: string;
      diffs?: { path?: string; markedAsViewed?: boolean | null }[];
    };

    return {
      paths: (payload?.diffs ?? [])
        .filter((file) => file?.markedAsViewed === true)
        .flatMap((file) => (file.path == null ? [] : [file.path])),
      baseSha: payload?.baseRefOid,
    };
  } catch (error) {
    return { paths: [], error: error instanceof Error ? error.message : String(error) };
  }
}
