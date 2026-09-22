import { useEffect, useState } from 'react';

import { BRIDGE_CHANNEL, isToViewer, type PageInfo } from '@/bridge';

/** What the content script put on the url, or the system's preference */
function firstThemeType(): PageInfo['themeType'] {
  const fromPage = new URLSearchParams(location.search).get('theme');
  if (fromPage === 'light' || fromPage === 'dark') return fromPage;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const FALLBACK: PageInfo = {
  title: '',
  themeType: firstThemeType(),
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
};

/**
 * The viewer runs on the extension's origin, so anything only the GitHub page
 * knows -- its title, its active theme -- arrives over the bridge
 */
export function usePageInfo(): PageInfo {
  const [info, setInfo] = useState<PageInfo>(FALLBACK);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent || !isToViewer(event.data)) return;
      if (event.data.type !== 'page-info') return;
      setInfo(event.data.info);
    };
    addEventListener('message', onMessage);
    parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'ready' }, '*');
    return () => removeEventListener('message', onMessage);
  }, []);

  return info;
}

export function closeViewer(): void {
  parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'close' }, '*');
}
