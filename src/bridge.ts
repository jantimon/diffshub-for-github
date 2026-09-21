/**
 * What the viewer and the GitHub page say to each other.
 *
 * The viewer is an extension page in an iframe, so it has its own origin. That
 * is what lets it run module workers and split its code, but it also means
 * GitHub treats it as a stranger: a write from that origin is refused, and on
 * Firefox the session cookie is not even sent. So anything that has to happen
 * as the reader, on github.com, is named here, asked for over postMessage, and
 * carried out by the content script.
 *
 * Both sides are driven by the `Requests` table below. Adding an action means
 * adding one line to it and one handler in the content script; the envelope,
 * the ids, the timeout and the types all follow from that line.
 */

export const BRIDGE_CHANNEL = 'diffshub-for-github';

export interface PageInfo {
  title: string;
  themeType: 'light' | 'dark';
  lightTheme: string;
  darkTheme: string;
  base?: string;
  head?: string;
  headSha?: string;
  /** The login of whoever opened the pull request. */
  author?: string;
}

export interface ReviewComment {
  /** GitHub's own id for the comment, which a reply has to name. */
  databaseId: string;
  author: string;
  body: string;
  /** GitHub's own rendering of the body, which is how a suggestion arrives. */
  bodyHTML: string;
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
  /** Not on GitHub yet: the box the reader is typing into. */
  isDraft?: boolean;
  comments: ReviewComment[];
}

export interface NewComment {
  path: string;
  line: number;
  side: 'additions' | 'deletions';
  text: string;
}

export type ReviewEvent = 'comment' | 'approve' | 'request changes';

/** The answer from an action that only has to say whether it worked. */
export interface Result {
  ok: boolean;
  error?: string;
}

/**
 * Everything the viewer asks the page to do: what it sends, and what it gets
 * back. `void` means the request carries nothing beyond its name.
 */
export interface Requests {
  /** Which files GitHub already has ticked off, and the commit the diff starts at. */
  viewed: { ask: void; reply: { paths: string[]; baseSha?: string; error?: string } };
  /** Ticking one file off, or putting it back. */
  'file-review': { ask: { path: string; viewed: boolean }; reply: Result };
  /** Every review comment on the pull request. */
  threads: { ask: void; reply: { threads: ReviewThread[]; truncated: boolean; error?: string } };
  /** A new comment on one line. */
  comment: { ask: NewComment; reply: Result };
  /** An answer to an existing comment. */
  reply: { ask: { inReplyTo: string; body: string }; reply: Result };
  /** Resolving a conversation, or reopening one. `resolved` is the state wanted. */
  resolve: { ask: { threadId: string; resolved: boolean }; reply: Result };
  /** The verdict that ends a review. */
  review: { ask: { event: ReviewEvent; body: string }; reply: Result };
  /** GitHub's own rendering of markdown, for the preview tab. */
  preview: { ask: { text: string }; reply: { html?: string; error?: string } };
}

export type RequestName = keyof Requests;
export type Ask<K extends RequestName> = Requests[K]['ask'];
export type Reply<K extends RequestName> = Requests[K]['reply'];

/**
 * One envelope for every request, and one for every answer. The id pairs them
 * up, because several can be in flight at once and every message arrives at
 * the same listener.
 */
export type Request = {
  [K in RequestName]: {
    channel: typeof BRIDGE_CHANNEL;
    type: 'request';
    id: number;
    name: K;
    ask: Ask<K>;
  };
}[RequestName];

export type Response = {
  [K in RequestName]: {
    channel: typeof BRIDGE_CHANNEL;
    type: 'response';
    id: number;
    name: K;
    reply: Reply<K>;
  };
}[RequestName];

export type FromViewer =
  | { channel: typeof BRIDGE_CHANNEL; type: 'ready' }
  | { channel: typeof BRIDGE_CHANNEL; type: 'close' }
  | Request;

export type ToViewer = { channel: typeof BRIDGE_CHANNEL; type: 'page-info'; info: PageInfo } | Response;

export function isToViewer(value: unknown): value is ToViewer {
  return (value as ToViewer | null)?.channel === BRIDGE_CHANNEL;
}

export function isFromViewer(value: unknown): value is FromViewer {
  return (value as FromViewer | null)?.channel === BRIDGE_CHANNEL;
}
