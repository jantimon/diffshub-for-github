/**
 * Which files GitHub already has marked as viewed.
 *
 * One request, and it reports the state rather than changing anything: the
 * file-filter menu on GitHub's own page would persist the setting server side.
 */
export async function readViewed(
  owner: string,
  repo: string,
  number: number
): Promise<{ paths: string[]; baseOid?: string; error?: string }> {
  try {
    const response = await fetch(`/${owner}/${repo}/pull/${number}/page_data/file_tree`, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
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
      baseOid: payload?.baseRefOid,
    };
  } catch (error) {
    return { paths: [], error: error instanceof Error ? error.message : String(error) };
  }
}
