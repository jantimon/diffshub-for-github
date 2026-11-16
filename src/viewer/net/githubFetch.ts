import { ask } from '@/viewer/bridge/ask';

/**
 * Fetches github.com from the viewer with the reader's own session.
 *
 * On Chrome the viewer's own `fetch` carries the session cookie.
 *
 * On Firefox nothing but the page has the session. Total Cookie Protection
 * signs the framed viewer out, and in a container tab the background is signed
 * out too. So the page asks for the address GitHub redirects the download to.
 * GitHub signs that address, so the viewer needs no session to download it.
 *
 * A browser test pins this down, because a profile with Total Cookie Protection
 * turned off makes the detour look unnecessary.
 */
export function githubFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!import.meta.env.FIREFOX) {
    return fetch(url, { credentials: 'include', signal });
  }
  return firefoxFetch(url, signal);
}

async function firefoxFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const { address, status, error } = await ask('signed-address', { url });
  if (address != null) return fetch(address, { credentials: 'omit', signal });

  // A 404 or 503 stays an answer, so the callers still wait and ask again
  if (status != null) return new Response(null, { status, statusText: error ?? '' });
  throw new Error(error ?? 'The page found no address to download from.');
}
