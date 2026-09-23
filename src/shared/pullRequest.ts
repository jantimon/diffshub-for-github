/**
 * Which pull request this is, and where its parts live on github.com.
 *
 * Both sides of the extension need this -- the content script to know what page
 * it is on, the viewer to build the addresses it fetches -- so it holds nothing
 * that touches the page. Everything read out of the DOM is in `page/pageInfo`.
 */

export const GITHUB_ORIGIN = 'https://github.com';

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

/** Where the pull request lives, which every one of its routes hangs off */
export function pullPath(ref: PullRequestRef): string {
  return `/${ref.owner}/${ref.repo}/pull/${ref.number}`;
}

export function readPullRequestRef(pathname = location.pathname): PullRequestRef | undefined {
  const match = PULL_PATH.exec(pathname);
  if (match == null) return undefined;
  const [, owner = '', repo = '', number = '0'] = match;
  return { owner, repo, number: Number(number) };
}

export function patchUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}${pullPath(ref)}.diff`;
}

export function filesUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}${pullPath(ref)}/files`;
}

/**
 * The paths GitHub's Files-changed tab navigates to. The older pull request
 * page uses `/files`, the React one `/changes`.
 */
export function filesPaths(ref: PullRequestRef): string[] {
  const base = pullPath(ref);
  return [`${base}/files`, `${base}/changes`];
}
