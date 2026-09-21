import type { FileDiffContentsLoader, FileDiffLoadedFiles } from '@pierre/diffs';

import { githubFetch } from '@/viewer/files/githubFetch';
import { reconstructOldFile } from '@/patch/reconstructOldFile';
import { rawFileUrl } from '@/viewer/files/fileLinks';
import type { PullRequestRef } from '@/pullRequest';

/**
 * Supplies both sides of a file so collapsed context can be expanded.
 *
 * New and deleted files are already complete in the patch, so they are refused.
 * Everything else fetches the head revision from github.com on the session
 * cookie and derives the old side from the patch.
 */
export function createFileLoader(pr: PullRequestRef, headSha: string): FileDiffContentsLoader {
  const cache = new Map<string, Promise<FileDiffLoadedFiles>>();

  return async (fileDiff) => {
    if (fileDiff.type === 'new' || fileDiff.type === 'deleted') {
      throw new Error(`${fileDiff.name} is complete in the patch already.`);
    }

    const key = `${fileDiff.name}\0${fileDiff.newObjectId ?? ''}`;
    const cached = cache.get(key);
    if (cached != null) return cached;

    const pending = load(pr, headSha, fileDiff);
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  };
}

async function load(
  pr: PullRequestRef,
  headSha: string,
  fileDiff: Parameters<FileDiffContentsLoader>[0]
): Promise<FileDiffLoadedFiles> {
  const url = rawFileUrl(pr, headSha, fileDiff.name);
  const response = await githubFetch(url);
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${fileDiff.name}.`);
  }

  const contents = await response.text();
  const newFile = { name: fileDiff.name, contents, cacheKey: `${headSha}-${fileDiff.name}` };

  if (fileDiff.type === 'rename-pure') {
    return { oldFile: null, newFile };
  }

  return {
    oldFile: {
      name: fileDiff.prevName ?? fileDiff.name,
      contents: reconstructOldFile(fileDiff, contents),
      cacheKey: `${headSha}-${fileDiff.name}-old`,
    },
    newFile,
  };
}
