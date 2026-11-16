/**
 * Where github.com redirects a download, asked on the reader's session.
 *
 * In a Firefox container tab only the content script has the session. It
 * cannot follow the redirect, because GitHub's content security policy does
 * not list the patch host. So it stops at the redirect, and the background,
 * which only sees the request, reads the address from it.
 */

import { describeError } from '@/shared/errors';
import { GITHUB_ORIGIN } from '@/shared/pullRequest';
import { ADDRESS_CHANNEL, type AddressAsk } from '@/shared/runtime';

export async function signedAddress(
  url: string,
): Promise<{ address?: string; status?: number; error?: string }> {
  // The viewer names the address, so do not trust it
  if (!url.startsWith(`${GITHUB_ORIGIN}/`)) return { error: 'Only github.com addresses are asked for.' };

  try {
    // `manual` loads nothing past the redirect, so the page's policy has nothing to refuse
    const response = await fetch(url, { credentials: 'include', redirect: 'manual' });
    // A 404 or 503 goes back as is, so the viewer can wait and ask again
    if (response.type !== 'opaqueredirect') return { status: response.status, error: response.statusText };
  } catch (error) {
    return { error: describeError(error) };
  }

  try {
    const address: unknown = await browser.runtime.sendMessage({
      channel: ADDRESS_CHANNEL,
      url,
    } satisfies AddressAsk);
    if (typeof address === 'string') return { address };
    return { error: 'The background script read no address from the redirect.' };
  } catch (error) {
    return { error: `The background script did not answer: ${describeError(error)}` };
  }
}
