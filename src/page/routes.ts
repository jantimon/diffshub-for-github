import { pullPath, type PullRequestRef } from '@/shared/pullRequest';

/**
 * Every GitHub route this extension calls, in one place.
 *
 * None of them is a public API. `research/github-internal-api/README.md` has
 * what each one takes and answers, how that was found out, and how sure it is.
 * When GitHub changes one, this list is where to start.
 */
export const routes = {
  /** The file list with each file's viewed state, and the commit the diff starts at */
  fileTree: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/file_tree`,
  /** The two commits the diff spans, which a new comment has to name */
  baseComparison: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/base_comparison_info`,
  /** Where each review thread sits, forty a page */
  threadPreviews: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/thread_previews`,
  /** The comments of each review thread, forty a page */
  threads: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/threads`,
  /** A new comment on a line, or a reply to one */
  createComment: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/create_review_comment`,
  /** Resolving a conversation, or reopening one */
  resolveThread: (pr: PullRequestRef, resolved: boolean) =>
    `${pullPath(pr)}/page_data/${resolved ? 'resolve_thread' : 'unresolve_thread'}`,
  /** Rewriting one of the reader's own comments */
  updateComment: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/update_review_comment`,
  /** Taking one of the reader's own comments down */
  deleteComment: (pr: PullRequestRef, databaseId: string) =>
    `${pullPath(pr)}/page_data/review_comments/${encodeURIComponent(databaseId)}`,
  /** A verdict and its covering note */
  submitReview: (pr: PullRequestRef) => `${pullPath(pr)}/page_data/submit_review`,
  /** Ticking a file off, or back on */
  fileReview: (pr: PullRequestRef) => `${pullPath(pr)}/file_review`,
};
