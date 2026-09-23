import { createRoot } from 'react-dom/client';

import { isToViewer } from '@/shared/bridge';
import { fromPage } from '@/viewer/bridge/postToPage';
import { Overlay } from '@/viewer/Overlay';
import type { PullRequestRef } from '@/shared/pullRequest';
import './style.css';

const params = new URLSearchParams(location.search);
const pr: PullRequestRef = {
  owner: params.get('owner') ?? '',
  repo: params.get('repo') ?? '',
  number: Number(params.get('number') ?? '0'),
};

/**
 * Forty hex characters or nothing. This url is the extension's own, but a value
 * read out of one and then put into a storage key is worth checking anyway
 */
const sha = params.get('sha');
const openedAtSha = sha != null && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;

// Outside React, so the keyboard arrives even before the first render
addEventListener('message', (event: MessageEvent) => {
  if (!fromPage(event) || !isToViewer(event.data) || event.data.type !== 'focus') return;
  focus();
});

createRoot(document.getElementById('root')!).render(<Overlay pr={pr} openedAtSha={openedAtSha} />);
