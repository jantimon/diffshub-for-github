import { createRoot } from 'react-dom/client';

import { Overlay } from '@/viewer/Overlay';
import type { PullRequestRef } from '@/pullRequest';
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

createRoot(document.getElementById('root')!).render(<Overlay pr={pr} openedAtSha={openedAtSha} />);
