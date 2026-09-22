/**
 * What the viewer and the GitHub page say to each other.
 *
 * The viewer is an extension page in an iframe, so it has its own origin. That
 * is what lets it run module workers and split its code, but it also means
 * GitHub treats it as a stranger: a write from that origin is refused, and on
 * Firefox the session cookie is not even sent.
 *
 * So anything that has to happen as the reader, on github.com, is named here,
 * asked for over postMessage, and carried out by the content script.
 *
 * Both sides are driven by the `Requests` table below. Adding an action means
 * adding one line to it and one handler in the content script. The envelope,
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
  /** The login of whoever opened the pull request */
  author?: string;
}

/**
 * One comment, as the page read it.
 *
 * The fields marked optional are optional because of when, not whether: an
 * update swaps the viewer while the content script already in the page is the
 * one from before, so for one reload the viewer reads what the older script
 * knew how to send. Everything here is checked at the point of use.
 */
export interface ReviewComment {
  /** GitHub's own id for the comment, which a reply has to name */
  databaseId: string;
  /** The author's GitHub login */
  author: string;
  /**
   * The author's picture, as GitHub serves it.
   *
   * It comes from the payload rather than from the login: an app comments
   * through an account with no user page, so `Copilot.png` is not its avatar,
   * and bots are common in a review.
   */
  avatarUrl?: string;
  /** The author is an app rather than a person */
  isAgent?: boolean;
  /** What the author is to the repository: `OWNER`, `MEMBER`, `CONTRIBUTOR` */
  association?: string;
  /** Changed since it was posted */
  isEdited?: boolean;
  /** GitHub will let the reader rewrite it, which in practice means it is theirs */
  canEdit?: boolean;
  /** GitHub will let the reader take it down */
  canDelete?: boolean;
  /** The markdown as it was written, for when GitHub sends no rendering */
  body: string;
  /** GitHub's own rendering of the body, which is how a suggestion arrives */
  bodyHTML: string;
  /** When it was left, as an ISO timestamp */
  createdAt: string;
  /** Where it lives on GitHub */
  url: string;
}

export interface ReviewThread {
  /** GitHub's own id for the conversation, which resolving has to name */
  id: string;
  /** The file the comment is on, as the diff names it */
  path: string;
  /** Null for a comment on the file rather than a line */
  line: number | null;
  /** Which half of the diff the line belongs to */
  side: 'additions' | 'deletions';
  /** Settled on GitHub. The viewer labels it, and `resolve` flips it */
  isResolved: boolean;
  /** The lines this was written against are no longer in the diff */
  isOutdated: boolean;
  /** Who settled it, empty while it is open */
  resolvedBy?: string;
  /** GitHub will take a reply. False on a locked or archived conversation */
  canReply?: boolean;
  /** Not on GitHub yet: the box the reader is typing into */
  isDraft?: boolean;
  /** The opening comment and its replies. A reply names the first one */
  comments: ReviewComment[];
}

export interface NewComment {
  path: string;
  line: number;
  side: 'additions' | 'deletions';
  text: string;
}

export type ReviewEvent = 'comment' | 'approve' | 'request changes';

/** The answer from an action that only has to say whether it worked */
export interface Result {
  ok: boolean;
  error?: string;
}

/**
 * Everything the viewer asks the page to do: what it sends, and what it gets
 * back. `void` means the request carries nothing beyond its name.
 */
export interface Requests {
  /** Which files GitHub already has ticked off, and the commit the diff starts at */
  viewed: { ask: void; reply: { paths: string[]; baseSha?: string; error?: string } };
  /** Ticking one file off, or putting it back */
  'file-review': { ask: { path: string; viewed: boolean }; reply: Result };
  /** Every review comment on the pull request */
  threads: { ask: void; reply: { threads: ReviewThread[]; truncated: boolean; error?: string } };
  /** A new comment on one line */
  comment: { ask: NewComment; reply: Result };
  /** An answer to an existing comment */
  reply: { ask: { inReplyTo: string; body: string }; reply: Result };
  /** Resolving a conversation, or reopening one. `resolved` is the state wanted. */
  resolve: { ask: { threadId: string; resolved: boolean }; reply: Result };
  /** Rewriting one of the reader's own comments */
  'edit-comment': { ask: { databaseId: string; body: string }; reply: Result };
  /** Taking one of the reader's own comments down */
  'delete-comment': { ask: { databaseId: string }; reply: Result };
  /** The verdict that ends a review */
  review: { ask: { event: ReviewEvent; body: string }; reply: Result };
  /** GitHub's own rendering of markdown, for the preview tab */
  preview: { ask: { text: string }; reply: { html?: string; error?: string } };
}

export type RequestName = keyof Requests;
export type Ask<K extends RequestName> = Requests[K]['ask'];
export type Reply<K extends RequestName> = Requests[K]['reply'];

/**
 * What each request answers with when it cannot be carried out: the page gave
 * no answer in time, or it is not a pull request page at all. The shapes
 * differ, so this is a table rather than one value, and the compiler checks it
 * covers every request. A new request is added here and in `Requests`.
 */
export const failedReply: { [K in RequestName]: (error: string) => Reply<K> } = {
  viewed: (error) => ({ paths: [], error }),
  'file-review': (error) => ({ ok: false, error }),
  threads: (error) => ({ threads: [], truncated: false, error }),
  comment: (error) => ({ ok: false, error }),
  reply: (error) => ({ ok: false, error }),
  resolve: (error) => ({ ok: false, error }),
  'edit-comment': (error) => ({ ok: false, error }),
  'delete-comment': (error) => ({ ok: false, error }),
  review: (error) => ({ ok: false, error }),
  preview: (error) => ({ error }),
};

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
