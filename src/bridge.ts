/** Messages between the GitHub page and the viewer that overlays it. */
export const BRIDGE_CHANNEL = 'diffshub-for-github';

export interface PageInfo {
  title: string;
  themeType: 'light' | 'dark';
  lightTheme: string;
  darkTheme: string;
  base?: string;
  head?: string;
}

export type ToViewer = { channel: typeof BRIDGE_CHANNEL; type: 'page-info'; info: PageInfo };

export type FromViewer =
  | { channel: typeof BRIDGE_CHANNEL; type: 'ready' }
  | { channel: typeof BRIDGE_CHANNEL; type: 'close' };

export function isToViewer(value: unknown): value is ToViewer {
  return (value as ToViewer | null)?.channel === BRIDGE_CHANNEL;
}

export function isFromViewer(value: unknown): value is FromViewer {
  return (value as FromViewer | null)?.channel === BRIDGE_CHANNEL;
}
