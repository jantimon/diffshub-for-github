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

createRoot(document.getElementById('root')!).render(<Overlay pr={pr} />);
