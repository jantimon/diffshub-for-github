/**
 * Reading the pull request out of the page.
 *
 * All of this runs in the content script, on github.com's origin, and depends
 * on GitHub's own markup. GitHub serves more than one pull request layout, so
 * each reader goes by something stable -- where a link points, the JSON the
 * page embeds for its own React app -- rather than by the classes around it.
 */

import * as v from 'valibot';

import { EmbeddedPullRequest } from '@/page/githubApiSchemas';
import { filesPaths, readPullRequestRef, type PullRequestRef } from '@/shared/pullRequest';

/** The PR title, from the page if it exposes one and from the tab title if not */
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

/** Whether a click landed on a link to this pull request's Files-changed tab */
export function findFilesChangedLink(
  target: EventTarget | null,
  ref: PullRequestRef,
): HTMLAnchorElement | undefined {
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return undefined;
  return filesPaths(ref).includes(linkPath(anchor)) ? anchor : undefined;
}

/** The icon's width and height in CSS pixels, for drawing it and for finding it */
export const MARKER_SIZE = 14;

/**
 * Whether a click at `x` landed on the icon rather than on the link's text.
 *
 * The icon is drawn by CSS as the last thing in the link, so it is no element
 * of its own and the click's target is the link either way. It ends where the
 * link's right padding starts, so it is found from there. A range over the
 * link's content is no help: in Chrome it takes in the icon too
 */
export function onMarker(link: HTMLAnchorElement, x: number): boolean {
  const box = link.getBoundingClientRect();
  const end = box.right - Number.parseFloat(getComputedStyle(link).paddingRight);
  // A little slack before the icon, since it is small
  return x >= end - MARKER_SIZE - 3 && x <= box.right;
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
 * The pull request as the page's own React app received it: an object under
 * one of the routes in `react-app.embeddedData`. Parsed rather than searched
 * with a pattern, so a key of the same name elsewhere in the payload, or
 * another pull request's data on the same page, cannot be read by mistake.
 */
function embeddedPullRequest(): v.InferOutput<typeof EmbeddedPullRequest> | undefined {
  const number = readPullRequestRef()?.number;
  for (const script of document.querySelectorAll(
    'script[type="application/json"][data-target="react-app.embeddedData"]',
  )) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const payload = (data as { payload?: unknown } | null)?.payload;
    if (payload == null || typeof payload !== 'object') continue;
    for (const route of Object.values(payload)) {
      const parsed = v.safeParse(
        EmbeddedPullRequest,
        (route as { pullRequest?: unknown } | null)?.pullRequest,
      );
      if (!parsed.success) continue;
      if (parsed.output.number != null && parsed.output.number !== number) continue;
      return parsed.output;
    }
  }
  return undefined;
}

/**
 * The head commit sha. Expanding collapsed context and the patch cache need
 * it. Without it both stay off rather than guessing a revision.
 */
export function readHeadSha(): string | undefined {
  const sha = embeddedPullRequest()?.headSha;
  return sha != null && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

/**
 * Who opened the pull request: the pull request's own author, not the first
 * author link in the document, which belongs to whoever acted last
 */
export function readAuthor(): string | undefined {
  return embeddedPullRequest()?.author?.login ?? undefined;
}
