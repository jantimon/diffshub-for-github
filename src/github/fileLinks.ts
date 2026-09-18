import { GITHUB_ORIGIN } from './pr';

export interface FileRefs {
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
}

/** Encode per segment so the slashes survive and everything else is escaped. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function shaFor(refs: FileRefs, side: 'base' | 'head'): string {
  return side === 'base' ? refs.baseSha : refs.headSha;
}

export function blobUrl(refs: FileRefs, path: string, side: 'base' | 'head'): string {
  return `${GITHUB_ORIGIN}/${refs.owner}/${refs.repo}/blob/${shaFor(refs, side)}/${encodePath(path)}`;
}

export function blameUrl(refs: FileRefs, path: string): string {
  return `${GITHUB_ORIGIN}/${refs.owner}/${refs.repo}/blame/${refs.headSha}/${encodePath(path)}`;
}

/**
 * The `/raw/` form on github.com rather than raw.githubusercontent.com, so the
 * request carries the session cookie and private repos work.
 */
export function rawUrl(refs: FileRefs, path: string, side: 'base' | 'head'): string {
  return `${GITHUB_ORIGIN}/${refs.owner}/${refs.repo}/raw/${shaFor(refs, side)}/${encodePath(path)}`;
}

export async function copyPath(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(path);
    return true;
  } catch {
    return false;
  }
}
