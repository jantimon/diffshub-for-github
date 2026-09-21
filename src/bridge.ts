/** Messages between the GitHub page and the viewer that overlays it. */
export const BRIDGE_CHANNEL = 'diffshub-for-github';

export interface PageInfo {
  title: string;
  themeType: 'light' | 'dark';
  lightTheme: string;
  darkTheme: string;
  base?: string;
  head?: string;
  headSha?: string;
}

export interface ReviewComment {
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  path: string;
  /** Null for a comment on the file rather than a line. */
  line: number | null;
  side: 'additions' | 'deletions';
  isResolved: boolean;
  /** The lines this was written against are no longer in the diff. */
  isOutdated: boolean;
  comments: ReviewComment[];
}

export type ToViewer =
  | { channel: typeof BRIDGE_CHANNEL; type: 'page-info'; info: PageInfo }
  | { channel: typeof BRIDGE_CHANNEL; type: 'file-review-result'; id: number; ok: boolean; status: number }
  | {
      channel: typeof BRIDGE_CHANNEL;
      type: 'threads-result';
      id: number;
      threads: ReviewThread[];
      truncated: boolean;
      error?: string;
    };

export type FromViewer =
  | { channel: typeof BRIDGE_CHANNEL; type: 'ready' }
  | { channel: typeof BRIDGE_CHANNEL; type: 'close' }
  | {
      channel: typeof BRIDGE_CHANNEL;
      type: 'file-review';
      id: number;
      path: string;
      viewed: boolean;
    }
  | { channel: typeof BRIDGE_CHANNEL; type: 'threads'; id: number };

export function isToViewer(value: unknown): value is ToViewer {
  return (value as ToViewer | null)?.channel === BRIDGE_CHANNEL;
}

export function isFromViewer(value: unknown): value is FromViewer {
  return (value as FromViewer | null)?.channel === BRIDGE_CHANNEL;
}
