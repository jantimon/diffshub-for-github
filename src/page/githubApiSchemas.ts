/**
 * What this extension reads out of GitHub's answers, as valibot schemas.
 *
 * None of these routes is documented, and GitHub changes them without notice.
 * Checking each answer against its schema turns a change into an error that
 * names the field, where a cast would give an empty viewer and no reason.
 *
 * Each schema asks for only what the code uses. Fields GitHub adds are dropped
 * rather than refused, and a field that may be missing or null is optional, so
 * only a change to something the extension needs is reported.
 * `research/github-internal-api/README.md` has the full answers.
 */

import * as v from 'valibot';

/** Ids arrive as strings on some routes and as numbers on others */
const Id = v.pipe(v.union([v.string(), v.number()]), v.transform(String));

/** `page_data/file_tree`: which files the reader has ticked, and the commit the diff starts at */
export const FileTree = v.object({
  baseRefOid: v.nullish(v.string()),
  diffs: v.array(
    v.object({
      path: v.string(),
      markedAsViewed: v.nullish(v.boolean()),
    }),
  ),
});

/** `page_data/base_comparison_info`: the commits a new comment has to name */
export const BaseComparison = v.object({
  pullRequest: v.object({
    comparison: v.object({ baseOid: v.string(), headOid: v.string() }),
  }),
});

/** One entry of `page_data/thread_previews`: where a conversation sits */
export const ThreadPreview = v.object({
  id: Id,
  path: v.string(),
  line: v.nullish(v.number()),
  diffSide: v.nullish(v.string()),
  subjectType: v.nullish(v.string()),
  isOutdated: v.nullish(v.boolean()),
});

/** One comment inside a conversation of `page_data/threads` */
export const ThreadComment = v.object({
  databaseId: Id,
  body: v.nullish(v.string()),
  bodyHTML: v.nullish(v.string()),
  author: v.nullish(
    v.object({
      login: v.string(),
      avatarUrl: v.nullish(v.string()),
      isAgent: v.nullish(v.boolean()),
    }),
  ),
  authorAssociation: v.nullish(v.string()),
  lastUserContentEdit: v.nullish(v.unknown()),
  viewerCanUpdate: v.nullish(v.boolean()),
  viewerCanDelete: v.nullish(v.boolean()),
  createdAt: v.nullish(v.string()),
  url: v.nullish(v.string()),
});

/** One conversation of `page_data/threads`: whether it is settled, and its comments */
export const Thread = v.object({
  id: Id,
  isResolved: v.nullish(v.boolean()),
  /** A login, as GitHub's own types say, or an object carrying one */
  resolvedBy: v.nullish(
    v.union([
      v.string(),
      v.pipe(
        v.object({ login: v.string() }),
        v.transform((user) => user.login),
      ),
    ]),
  ),
  viewerCanReply: v.nullish(v.boolean()),
  commentsData: v.object({ comments: v.array(ThreadComment) }),
});

/** A page of `thread_previews`: a bare list */
export const ThreadPreviewPage = v.array(ThreadPreview);

/** A page of `threads`: GitHub has sent both a bare list and one wrapped in `threads` */
export const ThreadPage = v.union([
  v.array(Thread),
  v.pipe(
    v.object({ threads: v.array(Thread) }),
    v.transform((page) => page.threads),
  ),
]);

/** The pull request in the data GitHub embeds in its page for its React app */
export const EmbeddedPullRequest = v.object({
  number: v.nullish(v.number()),
  headSha: v.nullish(v.string()),
  author: v.nullish(v.object({ login: v.nullish(v.string()) })),
});

/** The reason in a refusal, in whichever of its shapes GitHub used */
export const Refusal = v.object({
  message: v.nullish(v.string()),
  error: v.nullish(v.string()),
  errors: v.nullish(v.array(v.object({ message: v.nullish(v.string()) }))),
});

/**
 * Where an answer stopped matching its schema, as a short phrase for the
 * reader: the deepest field that did not fit, and what was expected there. A
 * union reports only that no option fitted, so its options' own issues are
 * looked through for the one that got furthest
 */
export function mismatch(issues: readonly v.BaseIssue<unknown>[]): string {
  const deepest = leaves(issues).toSorted((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
  if (deepest == null) return 'an unknown field';
  return `${v.getDotPath(deepest) ?? 'the answer'}: ${deepest.message}`;
}

function leaves(list: readonly v.BaseIssue<unknown>[]): v.BaseIssue<unknown>[] {
  return list.flatMap((issue) => (issue.issues == null ? [issue] : leaves(issue.issues)));
}
