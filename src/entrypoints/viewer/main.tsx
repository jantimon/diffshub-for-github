import { createRoot } from 'react-dom/client';

import { Overlay } from '@/ui/Overlay';
import type { PullRequestRef } from '@/github/pr';
import './style.css';

const params = new URLSearchParams(location.search);
const pr: PullRequestRef = {
  owner: params.get('owner') ?? '',
  repo: params.get('repo') ?? '',
  number: Number(params.get('number') ?? '0'),
};

createRoot(document.getElementById('root')!).render(<Overlay pr={pr} />);
