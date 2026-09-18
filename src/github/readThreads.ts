import type { ReviewThread } from '@/bridge';

const EMBEDDED_DATA =
  /<script[^>]+data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/;

interface RawComment {
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
}

interface RawThread {
  id?: string | number;
  isResolved?: boolean;
  commentsData?: { comments?: RawComment[] };
}

/**
 * Reads the review threads on a pull request.
 *
 * GitHub's own JSON endpoint returns the comments but not what they are
 * attached to. The line each one sits on is only in the data the changes page
 * embeds for its React app, so that page is fetched and read: `diffSummaries`
 * maps a file's lines to thread ids, and `markers.threads` holds the bodies.
 */
export async function readThreads(
  owner: string,
  repo: string,
  number: number
): Promise<{ threads: ReviewThread[]; error?: string }> {
  const response = await fetch(`/${owner}/${repo}/pull/${number}/changes`, {
    credentials: 'include',
  });
  if (!response.ok) {
    return { threads: [], error: `GitHub answered ${response.status} for the comments.` };
  }

  const match = EMBEDDED_DATA.exec(await response.text());
  if (match?.[1] == null) {
    return { threads: [], error: 'Could not read the comments from GitHub.' };
  }

  try {
    const route = (JSON.parse(match[1]) as Record<string, any>)?.payload?.pullRequestsChangesRoute;
    // A pull request with no review threads carries no summaries either, which
    // is not a failure.
    if (route == null) return { threads: [] };
    const bodies = (route?.markers?.threads ?? {}) as Record<string, RawThread>;
    const threads: ReviewThread[] = [];

    for (const summary of route?.diffSummaries ?? []) {
      const path = String(summary?.path ?? '');
      if (path === '') continue;

      for (const [key, marker] of Object.entries(summary?.markersMap ?? {})) {
        // Keys read `R12` for the new side of the diff and `L12` for the old.
        const line = Number(key.slice(1));
        if (!Number.isFinite(line)) continue;
        const side = key.startsWith('L') ? 'deletions' : 'additions';

        for (const reference of (marker as { threads?: { id?: string }[] })?.threads ?? []) {
          const id = String(reference?.id ?? '');
          const thread = bodies[id] ?? (reference as RawThread);
          threads.push({
            id,
            path,
            line,
            side,
            isResolved: thread?.isResolved === true,
            comments: (thread?.commentsData?.comments ?? []).map((comment) => ({
              author: comment?.author?.login ?? 'someone',
              body: comment?.body ?? '',
              createdAt: comment?.createdAt ?? '',
              url: comment?.url ?? '',
            })),
          });
        }
      }
    }

    return { threads };
  } catch (error) {
    return { threads: [], error: error instanceof Error ? error.message : String(error) };
  }
}
