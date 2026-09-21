/**
 * Rendering markdown the way GitHub will render it.
 *
 * The preview could be done here with a markdown library, but it would drift:
 * GitHub resolves `@mentions`, issue references, task lists, emoji and its own
 * alert syntax. In a review tool a preview that differs from what gets posted
 * is worse than none, so this asks GitHub.
 *
 * The page carries the address on a `data-preview-url` attribute, complete with
 * the repository and subject it belongs to, and the token beside it in a
 * `.js-data-preview-url-csrf` input. That is where GitHub's own preview code
 * looks, from its published source `behaviors/commenting/preview.ts`.
 */
export async function previewMarkdown(text: string): Promise<{ html?: string; error?: string }> {
  const host = document.querySelector<HTMLElement>('[data-preview-url]');
  const url = host?.getAttribute('data-preview-url');
  if (url == null) {
    return { error: 'GitHub is not offering a preview on this page.' };
  }

  const token =
    host?.querySelector<HTMLInputElement>('.js-data-preview-url-csrf')?.value ??
    document.querySelector<HTMLInputElement>('.js-data-preview-url-csrf')?.value;
  if (token == null) {
    return { error: 'GitHub did not supply a token for the preview.' };
  }

  const body = new FormData();
  body.set('text', text);
  body.set('authenticity_token', token);

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
      body,
    });
    if (!response.ok) return { error: `GitHub answered ${response.status} for the preview.` };
    return { html: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
