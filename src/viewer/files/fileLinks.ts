import { GITHUB_ORIGIN } from '@/pullRequest';

export interface FileRefs {
  owner: string;
  repo: string;
  /**
   * The commit the diff starts at. Absent until GitHub has been asked for it,
   * and on a pull request it declines to describe, so anything comparing the
   * two sides has to cope without it.
   */
  baseSha?: string;
  headSha: string;
}

/** Encode per segment so the slashes survive and everything else is escaped */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function shaFor(refs: FileRefs, side: 'base' | 'head'): string {
  return (side === 'base' ? refs.baseSha : refs.headSha) ?? refs.headSha;
}

export function blobUrl(refs: FileRefs, path: string, side: 'base' | 'head'): string {
  return `${GITHUB_ORIGIN}/${refs.owner}/${refs.repo}/blob/${shaFor(refs, side)}/${encodePath(path)}`;
}

export function blameUrl(refs: FileRefs, path: string): string {
  return `${GITHUB_ORIGIN}/${refs.owner}/${refs.repo}/blame/${refs.headSha}/${encodePath(path)}`;
}

/**
 * A file at one revision, in the `/raw/` form on github.com rather than on
 * raw.githubusercontent.com, so the request carries the session cookie and
 * private repositories work
 */
export function rawFileUrl(ref: { owner: string; repo: string }, sha: string, path: string): string {
  return `${GITHUB_ORIGIN}/${ref.owner}/${ref.repo}/raw/${sha}/${encodePath(path)}`;
}

export function rawUrl(refs: FileRefs, path: string, side: 'base' | 'head'): string {
  return rawFileUrl(refs, shaFor(refs, side), path);
}

export async function copyPath(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(path);
    return true;
  } catch {
    return false;
  }
}
