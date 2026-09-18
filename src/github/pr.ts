export const GITHUB_ORIGIN = 'https://github.com';

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

export function readPullRequestRef(pathname = location.pathname): PullRequestRef | undefined {
  const match = PULL_PATH.exec(pathname);
  if (match == null) return undefined;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function patchUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}/${ref.owner}/${ref.repo}/pull/${ref.number}.diff`;
}

export function filesUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}/${ref.owner}/${ref.repo}/pull/${ref.number}/files`;
}

/** The PR title as GitHub renders it, for the overlay header. */
export function readPullRequestTitle(): string {
  return document.querySelector('.js-issue-title, [data-testid="issue-title"]')?.textContent?.trim() ?? '';
}

export function readBranchPair(): { base: string; head: string } | undefined {
  const base = document.querySelector('.base-ref, [data-testid="base-ref"]')?.textContent?.trim();
  const head = document.querySelector('.head-ref, [data-testid="head-ref"]')?.textContent?.trim();
  if (base == null || head == null) return undefined;
  return { base, head };
}

/** GitHub's Files-changed tab, whichever markup this page happens to use. */
export function findFilesChangedTab(): HTMLAnchorElement | undefined {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/files"]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (!/\/pull\/\d+\/files(?:$|[?#])/.test(href)) continue;
    if (link.closest('nav, .tabnav, [role="tablist"]') == null) continue;
    return link;
  }
  return undefined;
}
