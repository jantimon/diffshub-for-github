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
  const [, owner = '', repo = '', number = '0'] = match;
  return { owner, repo, number: Number(number) };
}

export function patchUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}/${ref.owner}/${ref.repo}/pull/${ref.number}.diff`;
}

export function filesUrl(ref: PullRequestRef): string {
  return `${GITHUB_ORIGIN}/${ref.owner}/${ref.repo}/pull/${ref.number}/files`;
}

/** The PR title, from the page if it exposes one and from the tab title if not. */
export function readPullRequestTitle(): string {
  const heading = document
    .querySelector('.js-issue-title, [data-testid="issue-title"], [data-component="PH_Title"] bdi')
    ?.textContent?.trim();
  if (heading != null && heading !== '') return heading;

  // "<title> by <author> · Pull Request #123 · owner/repo"
  const match = /^(.*?)\s+by\s+\S+\s+·\s+Pull Request #\d+/.exec(document.title);
  return match?.[1]?.trim() ?? '';
}

export function readBranchPair(): { base: string; head: string } | undefined {
  const base = document.querySelector('.base-ref, [data-testid="base-ref"]')?.textContent?.trim();
  const head = document.querySelector('.head-ref, [data-testid="head-ref"]')?.textContent?.trim();
  if (base == null || head == null) return undefined;
  return { base, head };
}

/**
 * The paths GitHub's Files-changed tab navigates to. The older pull request
 * page uses `/files`; the React one uses `/changes`.
 */
export function filesPaths(ref: PullRequestRef): string[] {
  const base = `/${ref.owner}/${ref.repo}/pull/${ref.number}`;
  return [`${base}/files`, `${base}/changes`];
}

/** Whether a click landed on a link to this pull request's Files-changed tab. */
export function findFilesChangedLink(target: EventTarget | null, ref: PullRequestRef): HTMLAnchorElement | undefined {
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return undefined;
  return filesPaths(ref).includes(linkPath(anchor)) ? anchor : undefined;
}

/**
 * The Files-changed tab itself. GitHub serves more than one pull request
 * layout, so this goes by where the link points rather than by the markup
 * around it, and prefers one that sits in a tab strip.
 */
export function findFilesChangedTab(ref: PullRequestRef): HTMLAnchorElement | undefined {
  const wanted = filesPaths(ref);
  let fallback: HTMLAnchorElement | undefined;

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!wanted.includes(linkPath(link))) continue;
    if (link.closest('nav, .tabnav, [role="tablist"]') != null || link.getAttribute('role') === 'tab') {
      return link;
    }
    fallback ??= link;
  }

  return fallback;
}

function linkPath(link: HTMLAnchorElement): string {
  const href = link.getAttribute('href') ?? '';
  try {
    return new URL(href, location.origin).pathname;
  } catch {
    return '';
  }
}

/**
 * The head commit sha, read from the JSON the pull request page embeds for its
 * own React app. Expanding collapsed context needs it; without it that feature
 * stays off rather than guessing a revision.
 */
export function readHeadSha(): string | undefined {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent ?? '';
    if (!text.includes('headSha')) continue;
    const match = /"headSha"\s*:\s*"([0-9a-f]{40})"/.exec(text);
    if (match?.[1] != null) return match[1];
  }
  return undefined;
}
