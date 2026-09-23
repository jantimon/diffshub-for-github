import { useEffect, useState } from 'react';

import { BRIDGE_CHANNEL, isToViewer, type PageInfo } from '@/shared/bridge';
import { fromPage, postToPage } from '@/viewer/bridge/postToPage';

/** What the content script put on the url, or the system's preference */
function firstThemeType(): PageInfo['themeType'] {
  const onUrl = new URLSearchParams(location.search).get('theme');
  if (onUrl === 'light' || onUrl === 'dark') return onUrl;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const FALLBACK: PageInfo = {
  title: '',
  themeType: firstThemeType(),
  lightTheme: 'light-plus',
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
      if (!fromPage(event) || !isToViewer(event.data)) return;
      if (event.data.type !== 'page-info') return;
      setInfo(event.data.info);
    };
    addEventListener('message', onMessage);
    postToPage({ channel: BRIDGE_CHANNEL, type: 'ready' });
    return () => removeEventListener('message', onMessage);
  }, []);

  return info;
}

export function closeViewer(): void {
  postToPage({ channel: BRIDGE_CHANNEL, type: 'close' });
}
