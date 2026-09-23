# GitHub's internal web API

Reference for the cookie-authenticated HTTP routes that github.com's own JavaScript calls on a
signed-in pull request page. No token, no `api.github.com`, no scopes — the reader's session
cookie and a header.

## Where this came from

Two sources, marked separately throughout:

| marker | meaning |
| --- | --- |
| **read** | read in the original TypeScript, recovered from GitHub's published sourcemaps for the 321 bundles a signed-in PR page loads |
| **inferred** | deduced from call sites or file names; the literal was not read |
| **measured** | we sent the request and recorded the response |

Five agents each read a disjoint slice of the 321 bundles. Where two or more slices found the same
route independently, the route says so; that agreement is the strongest evidence here. Where they
disagree, both readings are given and the row is marked unresolved. Every route carries the
TypeScript path from the sourcemap so a reader can go back to the bundle and check.

A sixth pass searched for existing documentation of these endpoints and found none. One script in
one repository documents exactly one route. That is the entire public record; see
[What is documented nowhere else](#what-is-documented-nowhere-else).

Nothing here is official. There is no version, no deprecation policy, no published rate limit.
See [Stability and risk](#stability-and-risk).

---

## How the routes are built

### The verified-fetch header

**read** — `packages/verified-fetch/verified-fetch.ts` (slice 3, full source).

Every internal route the React app calls goes through one of four wrappers:

| helper | headers it adds |
| --- | --- |
| `verifiedFetch(path, init)` | `GitHub-Verified-Fetch: true` + `getBaseFetchHeaders()` |
| `verifiedFetchJSON(path, init)` | the above + `Accept: application/json`, `Content-Type: application/json`; `init.body` is `JSON.stringify`-ed |
| `reactFetch(path, init)` | `GitHub-Is-React: true`, then `verifiedFetch` |
| `reactFetchJSON(path, init)` | `GitHub-Is-React: true`, then `verifiedFetchJSON` |

Header casing as written in the source: `'GitHub-Verified-Fetch': 'true'`, `'GitHub-Is-React': 'true'`.
HTTP header names are case-insensitive, so `github-verified-fetch: true` works too.

The docstring in that file is the key to the whole API:

> the Rails controller must include `ApplicationController::VerifiedFetchDependency` and list the
> action in `allow_verified_fetch only:`

**No `authenticity_token` is sent by any of the four helpers.** The `GitHub-Verified-Fetch` header
*is* the CSRF substitute: a cross-origin form post cannot set a custom header, so the server uses
its presence to tell a same-origin `fetch` from a forged navigation. That is why these routes need
no token while old-style Rails form posts on the same page still carry one.

Two other behaviours read in the same file:

- Cross-origin is refused client-side: `assertRelativePathOrSameOrigin` throws
  `Can not make cross-origin requests from verifiedFetch`.
- `_features` and `_tracing` search params present on `window.location` are copied onto every
  outgoing request (`addStaffMagicParams`).

`fetchRefreshUrl` in `packages/alive/session.ts` sends the same header on a bare `POST`
(**read**, slices 3, 4 and 5 — three-way agreement on the literal `GitHub-Verified-Fetch: true`).

### The headers we send

**measured.** Every call our extension makes carries:

```
accept: application/json
x-requested-with: XMLHttpRequest
credentials: 'include'
```

and on writes:

```
content-type: application/json
github-verified-fetch: true
```

No `authenticity_token`. No `X-Fetch-Nonce`. Every route we use answers without them.

### The rest of the base headers

**read** — `packages/fetch-headers/fetch-headers.ts` and `packages/fetch-nonce/fetch-nonce.ts`
(slice 2). `getBaseFetchHeaders()` adds `X-Requested-With: XMLHttpRequest`, `X-Fetch-Nonce`, a
client-version header, and optionally `X-GitHub-UI-Service: true`. `X-GitHub-App-Type` is
`navigator` or `dataRouter`.

When `<html override-fetch>` is set, `window.fetch` itself is patched to add the base headers to
every request (`packages/fetch-overrides/fetch-overrides.ts`).

**Unresolved — `X-Fetch-Nonce` direction.** Slice 2 reads `fetch-nonce.ts` as a *request* header
seeded from `<meta name="fetch-nonce">`, with `X-Fetch-Nonce-To-Validate` alongside it and all
known nonces comma-joined when validating an unknown one. Slice 5 reads `packages/turbo/events.ts`
pulling `X-Fetch-Nonce` off *responses* and concludes it is a response header only. Both readings
are literal. Most likely both: the response mints, the request replays. Moot for us — we send no
nonce and nothing rejects us (**measured**).

### The `page_data` URL template

**read**, two independent slices, two different files:

`packages/pull-requests/routes/page-data-query.ts` (slice 3):

```ts
export function pageDataQueryDeps({params, name}) {
  return {pathname: `/${params.owner}/${params.repo}/pull/${params.pr_number}/page_data/${name}`}
}
```

`packages/pull-request-page-data-tooling/hooks/use-page-data-url.ts` (slice 5):

```ts
export function pageDataUrlWithSuffix(basePageDataUrl, pageDataName, pathSuffix?, params?) {
  let baseUrl = `${basePageDataUrl}/page_data/${pageDataName}`
  if (pathSuffix) baseUrl += `/${pathSuffix}`
  if (params) baseUrl += `?${params}`
  return getInsightsUrl(baseUrl)
}
```

So:

```
/:owner/:repo/pull/:number/page_data/:name[/:suffix][?params]
```

Confirmed by 5 slices; 2 read the builder in source, 3 inferred it from call sites.
`basePageDataUrl` is a single server-supplied string, not assembled client-side — on a PR page it
is `/:owner/:repo/pull/:number`, and for stacked PRs another PR's `pull.url` is fed in as the base.

`getInsightsUrl` (`@github-ui/api-insights-tracing`) wraps every such URL and probably appends a
tracing param. The module is in none of the six slices; the param is unknown, and omitting it works
(**measured**).

### Casing

There is no rule. Read the table for each route.

- Route *names* in the path are snake_case, always.
- JSON bodies are mostly camelCase, with snake_case fields mixed into the same object
  (`{threadId, resolution_reason}`).
- Query params are mostly snake_case (`thread_ids`, `merge_method`), except when they are not
  (`threadIds[]`).
- Boolean values are sometimes booleans, sometimes the strings `'true'`/`'false'`, sometimes the
  numbers `1`/`0`.

Every instance is listed under [Casing traps](#casing-traps). This is the part that makes the API
impossible to guess.

---

## Verified against the live API

Five claims below were confirmed by an actual request, not by reading source. They are the only
ones in this document with that status.

### `resolve_thread` takes `threadId`, not `thread_id`

```
POST /:owner/:repo/pull/:n/page_data/resolve_thread   {"threadId": "..."}
  -> 200 {"message":"Thread was successfully resolved."}

POST /:owner/:repo/pull/:n/page_data/resolve_thread   {"thread_id": "..."}
  -> 404 {"error":"Not Found"}

POST /:owner/:repo/pull/:n/page_data/resolve_review_thread
  -> 422, HTML error page
```

A 404 with a JSON body means the route exists and rejected the payload. A 422 with an HTML error
page is the signature of a route that does not exist — useful for probing.

### `DELETE review_comments/:id` works although the client no longer calls it

```
DELETE /:owner/:repo/pull/:n/page_data/review_comments/:commentDatabaseId  ->  204, comment gone
```

In GitHub's own client-side route registry (`payloads/page-data.ts`) this entry is commented out:

```ts
// deleteReviewComment: (id: number) => `review_comments/${id}`,
```

The server still answers it. A live mutation hook also still builds the path by hand — see
[Delete a review comment](#delete-a-review-comment).

### `update_review_comment` returns a body version

```
PUT /:owner/:repo/pull/:n/page_data/update_review_comment   {"body": "...", "commentId": "..."}
  -> 200 {"bodyVersion":"<sha>"}
```

**`commentId` is the database id, as a string** — `"4061602195"`. The node id (`PRRC_…`) from
the same `threads` payload answers `404 {"error":"Not Found"}`. Measured with both on one comment.

The edit is visible in a subsequent `page_data/threads` read. Slice 2 read a wider response type
for this route (`{body, bodyHTML, bodyVersion, commentDatabaseId, threadId}`); what came back on the
wire was the single field. Unresolved whether the wider shape is conditional or stale in the types.

### `baseRefOid` is the merge base, not the base branch tip

`file_tree`'s `baseRefOid` equals `base_comparison_info`'s `pullRequest.comparison.baseOid`, checked
across four pull requests including old ones whose base branch has moved on by years. So it is the
diff's merge base. Use it as the `base` half of a `range` param; do not resolve the base branch name.

### The headers

Listed above under [The headers we send](#the-headers-we-send). Every route we use works with that
set and nothing more.

---

## Pull request and review routes

All relative to `BASE = /:owner/:repo/pull/:number`.

### Route-name registry

**read verbatim** — `packages/pull-request-page-data-tooling/payloads/page-data.ts` (slice 5). This
is the client's own complete list of `page_data` names, split into reads and mutations.

Reads (`GET BASE/page_data/<name>`):

| TS key | route name | | TS key | route name |
| --- | --- | --- | --- | --- |
| activity | `catch_up` | | mergeInstructions | `merge_instructions` |
| agentMerge | `agent_merge` | | mergeRequestStatus | `merge_request_status` |
| agentMergeSession | `agent_merge_session` | | participants | `participants` |
| annotations | `annotations` | | pendingReview | `pending_review` |
| assignees | `assignees` | | previewStack | `preview_stack` |
| availableReviewers | `reviewers` | | reviewRequests | `review_requests` |
| baseComparisonInfo | `base_comparison_info` | | richDiff | `rich_diff` |
| changeGroups | `change_groups` | | stack | `stacks` |
| ciFindings | `ci_findings` | | stackMergeability | `stack_mergeability` |
| codeButton | `code_button` | | stackRebaseStatus | `stack_rebase_status` |
| codeowners | `codeowners` | | statusChecks | `status_checks` |
| conversationComments | `conversation_comments` | | suggestedReviewers | `suggested_reviewers` |
| description | `description` | | tabCounts | `tab_counts` |
| development | `development` | | threadPreviewPositioning | `thread_preview_positioning` |
| diffContextLines | `diff_entry_lines` | | threadPreviews | `thread_previews` |
| diffEntries | `diff_entries` | | threads | `threads` |
| diffstat | `diffstat` | | timeline | `timeline` |
| diffViewUserSettings | `user_diff_view_settings` | | | |
| fileTree | `file_tree` | | | |
| findings | `findings` | | | |
| header | `header` | | | |
| labels | `labels` | | | |
| mergeBox | `merge_box` | | | |

Mutations (`POST`/`PUT`/`PATCH`/`DELETE BASE/page_data/<name>`):

| TS key | route name | | TS key | route name |
| --- | --- | --- | --- | --- |
| abandonReview | `abandon_review` | | reopenPullRequest | `reopen_pull_request` |
| addCommentReaction | `add_comment_reaction` | | reRequestReviewFromUser | `re_request_review_from_user` |
| applySuggestedChanges | `apply_review_suggestions` | | resolveThread | `resolve_thread` |
| changeBase | `change_base` | | restoreHeadRef | `restore_head_ref` |
| cleanupCodespaces | `cleanup_codespaces` | | reviewMenu | `review_menu` |
| closePullRequest | `close_pull_request` | | runActionRequiredWorkflows | `run_action_required_workflows` |
| convertToDraft | `convert_to_draft` | | stackRebase | `stack_rebase` |
| createReviewComment | `create_review_comment` | | submitCopilotGroupsFeedback | `submit_copilot_groups_feedback` |
| createStackOrAppend | `pull_request_stacks` | | submitFeatureFeedback | `submit_feature_feedback` |
| deleteHeadRef | `delete_head_ref` | | submitPullRequestTimelineComment | `create_timeline_comment` |
| dequeuePullRequest | `dequeue_pull_request` | | submitReview | `submit_review` |
| disableAutoMerge | `disable_auto_merge` | | submitSuggestedChanges | `apply_suggestions` |
| dismissReview | `dismiss_review` | | unhideComment | `unhide_comment` |
| enableAutoMerge | `enable_auto_merge` | | unresolveThread | `unresolve_thread` |
| enqueueStack | `enqueue_stack` | | unstackPullRequests | `pull_request_stacks` |
| generateChangeGroups | `generate_change_groups` | | updateAgentMerge | `agent_merge` |
| hideComment | `hide_comment` | | updateDescription | `update_description` |
| markReadyForReview | `mark_ready_for_review` | | updateMergeBoxUserPreference | `update_merge_box_user_preference` |
| merge | `merge` | | updatePullRequestBranch | `update_pull_request_branch` |
| modifyAssignees | `modify_assignees` | | updateReviewComment | `update_review_comment` |
| modifyLabels | `modify_labels` | | updateShowChangeGroupsPreference | `update_show_change_groups_preference` |
| modifyReviewers | `modify_reviewers` | | updateTitle | `update_title` |
| removeCommentReaction | `remove_comment_reaction` | | updateWhitespacePreference | `update_whitespace_preference` |

Three notes on the registry:

1. **It is not exhaustive.** Slice 3 **read** literal `page_data/deployments`,
   `page_data/update_file_tree_width_preference` and `page_data/update_docked_panel_width_preference`
   in route files and path helpers. None of the three appear in this registry. Routes exist outside it.
2. Slice 4 independently recovered 8 name→value pairs from protobuf doc comments and literals —
   `timeline`, `file_tree`, `reviewers`, `suggested_reviewers`, `thread_preview_positioning`,
   `catch_up`, `create_timeline_comment`, `close_pull_request`. All 8 match this registry exactly.
   Confirmed by 2 slices.
3. Two inferences were **wrong**, which is the reason inferred names stay marked. Slice 3 guessed
   `ci_findings` (right) and `diff_view_user_settings` (wrong — it is `user_diff_view_settings`).
   Slice 2 guessed `diff_context_lines` (wrong — it is `diff_entry_lines`).

`createStackOrAppend` and `unstackPullRequests` share the name `pull_request_stacks`; `agentMerge`
and `updateAgentMerge` share `agent_merge`. Method distinguishes them.

### Reads

#### Threads

| | |
| --- | --- |
| path | `GET BASE/page_data/threads` |
| query | `after=<cursor>`, where the cursor is the minimum thread id of the previous page |
| pagination | follow the `Link: …; rel="next"` **response header**; do not build the next URL |
| response | `Thread[]` |
| evidence | **read** — `packages/pull-requests/page-data/loaders/use-threads.ts` (slice 2) |

`Thread`, **read** in `packages/diff-lines/conversation-types.ts`:

```ts
type Thread = {
  commentsData?: {comments: Comment[]; __id?: string}
  id: string
  isResolved?: boolean
  isOutdated?: boolean            // at the head of the PR
  resolvedBy?: string
  resolutionReason?: string | null
  positioning?: ThreadPositioning
  subject?: ThreadSubject         // deprecated in favour of positioning
  viewerCanReply?: boolean
  author?: Author | null
  commentCount?: number
  reviewCommentsLimit?: number
  reviewCommentsLimitExceeded?: boolean
  diffSide?: 'LEFT' | 'RIGHT'
  subjectType?: 'LINE' | 'FILE'
  line?: number | null
  startLine?: number | null
  startDiffSide?: 'LEFT' | 'RIGHT' | null
  originalDiffPathUri?: string | null
  path?: string
}
type ThreadPositioning = {endLine?; endDiffSide?; isOutdated: boolean; path: string; startDiffSide?; startLine?}
```

`Comment` carries `author`, `authorAssociation`, `automatedComment?`, `body`, `bodyHTML`,
`bodyVersion?`, `createdAt`, `publishedAt`, `currentDiffResourcePath?`, `id`, `databaseId`,
`lastUserContentEdit`, `reference {number, text?, author {login}}`,
`repository {id, isPrivate, name, owner {id, login, url}}`, `reviewId?`, `reviewVariantType?`
(`vanilla | code_scanning | copilot | dependabot | code_quality | automated`), `state`,
`viewerCanUnminimize`, `viewerDidAuthor`, `subjectType?`, `stafftoolsUrl?`, `url`, plus the
Reactable / Minimizable / Deletable / Updatable / OrgBlockable / Reportable mixins.

#### Thread previews

| | |
| --- | --- |
| path | `GET BASE/page_data/thread_previews` |
| query | none; follows `Link: rel="next"` |
| response | `ThreadPreviewsCompPayload` (legacy, has `previewInfo`) **or** `Thread[]` with `commentsData` (current). The client sniffs with `isThreadPreviewComp(json[0])` — expect either. |
| evidence | **read** — `…/page-data/loaders/use-thread-previews.ts` (slice 2) |

#### Thread preview positioning

| | |
| --- | --- |
| path | `GET BASE/page_data/thread_preview_positioning` |
| query | `thread_ids=<id,id,…>` — comma-joined, **snake_case** |
| response | proto3-JSON `ThreadPreviewPositioningResponse {threads: {[threadId]: PositionedThread}}` |
| | `PositionedThread {commitOid, diffLines: DiffLine[], endDiffSide, endLine, path, startDiffSide, startLine, isOutdated, originalDiffPathUri}`; `DiffLine {html, left, right, text, type}`. A legacy shape returned a bare object keyed by thread id. |
| evidence | **read** — `…/loaders/use-thread-preview-positioning.ts`, schema `dotcom-schema/src/gen/pull_requests/v1/thread_preview_positioning_pb.ts` (slice 4) |

Compare the next route: the same feature area, the opposite casing.

#### Review menu

| | |
| --- | --- |
| path | `GET BASE/page_data/review_menu` |
| query | `threadIds[]=<id>&threadIds[]=<id>…` — **repeated, camelCase inside the brackets**, exact casing as written |
| response | `ReviewMenuData {threads?: Thread[], …}` |
| evidence | **read** — `…/page-data/loaders/use-review-menu-data.ts` (slice 4) |

#### File tree

| | |
| --- | --- |
| path | `GET BASE/page_data/file_tree` |
| query | none |
| response | proto3-JSON `FileTreeResponse` |
| evidence | **read** — `…/loaders/use-file-tree-diff-summaries.ts`, schema `…/file_tree_pb.ts` (slice 4) |

```
FileTreeResponse { baseRefOid, commits[], diffs: DiffSummary[], lastReviewOid, ownerLogin,
                   pathName, pullRequestId, pullRequestNumber, repositoryName }
DiffSummary      { changeType, isCodeowner, isManifestFile, isVendored, linesAdded, linesChanged,
                   linesDeleted, markedAsViewed, path, pathDigest, highestAnnotationLevel,
                   markersMap<string, MarkerCollection>, isSymlink }
MarkerCollection { threads: Marker[], annotations: Marker[], ctx: int[] }
Marker           { id, start, outdatedReason }
```

`baseRefOid` is the merge base — **measured**, see above.

#### Base comparison info

| | |
| --- | --- |
| path | `GET BASE/page_data/base_comparison_info` |
| query | `range=<baseSha>..<headSha>`, or `range=<headSha>` alone when base equals head or base is missing |
| response | `FilesRoutePayload`, containing `pullRequest.comparison.baseOid` |
| evidence | **read** — `…/loaders/use-diff-comparison-data.ts` (slice 4) |

#### Diff entries

| | |
| --- | --- |
| path | `GET BASE/page_data/diff_entries` |
| query | `paths` (comma-joined, each `encodeURIComponent`-ed); `ctx` (per-path injected context ranges, `a-b` comma-joined within a path, `:`-joined across paths, same order as `paths`); `w` (`1` hide whitespace, `0` show); `range` (`headOid` when `effectiveRange.baseOid === fullDiff.baseOid`, else `baseOid..headOid`); `outdated=1` when the comparison is outdated |
| response | `DiffEntry[]` |
| evidence | **read** — `…/loaders/use-diff-entries.ts` (slice 2) |

```ts
type DiffEntryData = {
  diffLines: DiffLine[]; isBinary: boolean; isTooBig: boolean; linesChanged: number
  newTreeEntry; newCommitOid?; objectId: string; oldTreeEntry; oldCommitOid?
  path: string; pathDigest: string; status: PatchStatus; truncatedReason: string | null
}
type DiffEntry = DiffEntryData & {
  isSubmodule?; richDiff?; submodule?; helpUrl: string; diffSize: string
  linesAdded: number; linesDeleted: number; changeType: string; collapsed?: boolean; reviewed?: boolean
}
type DiffLine = {left: number|null; right: number|null; blobLineNumber: number
  displayNoNewLineWarning?; position?; type; html; text
  key?: `b:${n}-l:${n|null}-r:${n|null}`; hasHiddenUnicode?}
```

Two code paths sit behind the feature flag `pr_sfv_new_diff_fetch`; both hit the same URL, the
flagged one skips paths already in the TanStack cache.

#### Diff context lines

| | |
| --- | --- |
| path | `GET BASE/page_data/diff_entry_lines` |
| query | `path`; repeated `context_line_ranges[]=<JSON {start,end}>`; `w` (default `"0"`); `range` (same rule as `diff_entries`) |
| response | `{diffEntryLines?: DiffLine[]}` |
| evidence | route name **read** in the registry (slice 5); query and response **read** in `…/loaders/use-context-lines-data.ts` (slice 2), which guessed the path as `diff_context_lines` |

#### Rich diff

| | |
| --- | --- |
| path | `GET BASE/page_data/rich_diff` |
| query | `path` (always sent); `range` (same rule as `diff_entries`) |
| response | `Pick<RichDiff, 'proseDiffHtml' \| 'renderInfo' \| 'dependencyDiffPath'>` |
| notes | supports `AbortSignal` |
| evidence | **read** — `…/loaders/use-rich-diff-page-data.ts` (slice 4) |

#### Annotations

| | |
| --- | --- |
| path | `GET BASE/page_data/annotations` |
| query | `end_commit_oid=<sha>` (anchors pagination), `after=<cursor>`, `page=2` (only when page 1 came from the initial payload) |
| pagination | `Link: rel="next"` |
| response | `AnnotationsPayload` (array) |
| evidence | **read** — `…/loaders/use-annotations.ts` (slice 4) |

#### Codeowners

| | |
| --- | --- |
| path | `GET BASE/page_data/codeowners` |
| response | `{ownershipByPath: {[path]: {isOwnedByViewer, owners, ruleLineNumber, ruleUrl}}}` |
| evidence | **read** — `…/loaders/use-codeowners-data.ts` (slice 2) |

#### Timeline and conversation comments

| path | query | response | evidence |
| --- | --- | --- | --- |
| `GET BASE/page_data/timeline` | paginates via `Link: rel="next"`, next URL used verbatim | proto3-JSON `TimelineResponse {items: TimelineItem[]}` | **read**, `…/loaders/use-timeline.ts` (slice 4) |
| `GET BASE/page_data/catch_up` | `since=<ISO ts>` — **required**, the query is disabled without it. `_tracing` and `disable_clusters` may be merged in | proto3-JSON `ActivityResponse {summary: CatchUpTimelineSummary, timeline: TimelineItem[]}` | **read**, `…/overview/data/use-activity-page-data.ts` (slice 4) |
| `GET BASE/page_data/conversation_comments` | `direction=desc` is **always forced** onto the URL, other params preserved; `Link: rel="next"` | `ConversationCommentsPagePayload {items: ConversationComment[], aliveChannel?: string \| null}` | **read**, `…/loaders/use-conversation-comments.ts` (slice 4) |
| `GET BASE/page_data/conversation_comments/:type/:id` | `:type` is `issue` or `review_summary`; `:id` numeric | `ConversationCommentPayload` (one item) | same file |

`conversation_comments` returns an `aliveChannel`. Subscribing to it yields
`{id: number, item_type: 'issue'\|'review_summary', event_type: 'create'\|'update'\|'delete'}`;
`create`/`update` trigger the single-item GET above, and a `create` of a `review_summary` also
invalidates the threads query.

#### Other reads

| path | query | response | evidence |
| --- | --- | --- | --- |
| `GET BASE/page_data/header` | — | `HeaderPageData` | **read**, `…/loaders/use-header-page-data.ts` (slice 4) |
| `GET BASE/page_data/description` | — | `DescriptionData {body?, bodyHtml, bodyVersion?, editInformation?}` | **read**, `…/loaders/use-description-data.ts` (slice 4) |
| `GET BASE/page_data/tab_counts` | — | `NavigationCounterPageData` | **read**, `routes/layout-route.ts` (slice 3) |
| `GET BASE/page_data/diffstat` | — | proto `DiffstatResponse {diffstat?: {linesAdded?, linesDeleted?, linesChanged?}}` | **read**, `routes/layout-route.ts` (slices 2, 3) |
| `GET BASE/page_data/review_requests` | — | proto `ReviewRequestsResponse` | **read**, `routes/overview-route.ts` (slices 3, 4) |
| `GET BASE/page_data/reviewers` | `q=<query>` optional; empty `q` returns a capped initial set | proto `AvailableReviewersResponse {availableReviewers: Reviewer[]}` | **read**, `…/loaders/use-available-reviewers.ts` (slice 4) |
| `GET BASE/page_data/suggested_reviewers` | — | proto `SuggestedReviewersResponse {suggestedReviewers: [{reviewer, description}]}` | **read**, `…/loaders/use-suggested-reviewers.ts` (slice 4) |
| `GET BASE/page_data/assignees` | — | proto `AssigneesResponse {assignees, suggestedAssignees}` | **read**, `routes/overview-route.ts` (slice 3) |
| `GET BASE/page_data/labels` | — | proto `LabelsResponse {labels: PullRequestLabel[]}` | same |
| `GET BASE/page_data/participants` | — | proto `ParticipantsResponse {participants, totalCount}` | same |
| `GET BASE/page_data/development` | — | proto `DevelopmentResponse {linkedIssues: LinkedIssue[]}` | same |
| `GET BASE/page_data/deployments` | — | proto `DeploymentsResponse {deployments, aliveChannel}` | **read**, same file — **but absent from the registry** |
| `GET BASE/page_data/status_checks` | — | `StatusChecksPageData` (below) | **read**, `mergebox/page-data/loaders/use-status-checks-page-data.ts` (slices 2, 5) |
| `GET BASE/page_data/merge_box` | `merge_method=<MergeMethod>&bypass_requirements=<bool>` — **snake_case query, camelCase bodies elsewhere on the same route family** | `MergeBoxPageData` | **read**, `…/loaders/use-merge-box-page-data.ts` (slice 5) |
| `GET BASE/page_data/stack_mergeability` | same two params; issued once per stack entry against that entry's own base URL | — | same (slice 5) |
| `GET BASE/page_data/ci_findings` | — | `CIFindingsResponse {ciFindings[], headSha, checkRunsForAnalysis[], resultsReady, jobStatus}`. Poll every 10 s while pending, give up after 2 hours; 5xx is `ServerUnavailableError` | **read**, `mergebox/components/sections/checks/use-ci-findings.ts` (slice 3) |
| `GET BASE/page_data/stacks` | — | `{id, stack: {baseBranch, id, repositoryOwnerLogin, repositoryName, position, size, pulls: [{headBranch, isUnstackable, title, number, state, url}]}}` (typebox-validated) | **read**, `packages/stack-badge/use-stack-data.ts` (slice 1) |
| `GET BASE/page_data/preview_stack` | — | `PreviewStackData \| null` | **read**, `…/loaders/use-preview-stack-data.ts` (slice 4) |
| `GET BASE/page_data/change_groups` | — | `ChangeGroupPayload` | **read**, `…/loaders/use-change-groups-data.ts` (slice 4) |
| `GET BASE/page_data/code_button` | — | `CodeButtonData` | **read**, `…/loaders/use-code-button-data.ts` (slice 1) |
| `GET BASE/page_data/user_diff_view_settings` | — | `UserDiffViewSettings` | **read** (name from the registry, slice 5; call site slice 3) |
| `GET BASE/page_data/stack_rebase_status` | — | `{jobState: 'PENDING'\|'RUNNING'\|'DONE', pullRequestStates: [...]}` | **read**, `…/use-stack-rebase-mutation.ts` (slice 5) |
| `GET BASE/page_data/merge_request_status/:uuid` | path suffix is `encodeURIComponent(uuid)`; `cache: 'no-store'` | `{status: 'pending'\|'enqueued'\|'merged'\|'failed', …}` | **read**, `…/use-async-merge-request.ts` (slice 5) |
| `GET BASE/file_metadata/:base_sha/:head_sha` | path params, not query | proto `FileMetadataResponse {baseSha, headSha, files[], commits[], counts}`. The client rejects the response if the shas do not match the request | **read**, `…/loaders/use-file-metadata.ts` (slice 4) |

`StatusChecksPageData`, **read** in `mergebox/page-data/payloads/status-checks.ts` (slice 5):

```ts
{
  aliveChannels: {commitHeadShaChannel: string}
  statusRollup: {
    summary: {state, count}[]
    combinedState: 'FAILED'|'PASSED'|'PENDING'|'PENDING_APPROVAL'|'PENDING_FAILED'|'SOME_FAILED'|'PENDING_CONFLICTS'
    pendingWorkflowApprovalRollup: {workflowsRequiringApprovalCount, viewerCanApproveWorkflowRuns,
      hasExpiredWorkflowRuns, approvalRequiredMessage, helpLink} | null
  }
  statusChecks: Array<{additionalContext, avatarBackgroundColor?, avatarUrl,
    copilotCheckRunFailureContext?: {jobId: number; headRef?: string|null}|null, description,
    displayName, durationInSeconds, isRequired, state, stateChangedAt, targetUrl}>
}
```

`state` is one of ACTION_REQUIRED, CANCELLED, COMPLETED, ERROR, EXPECTED, FAILURE, IN_PROGRESS,
NEUTRAL, PENDING, QUEUED, REQUESTED, SKIPPED, STALE, STARTUP_FAILURE, SUCCESS, TIMED_OUT, WAITING,
`_UNKNOWN_VALUE`.

Proto payload shapes for the Overview queries, **read** in
`packages/dotcom-schema/src/gen/pull_requests/v1/*_pb.ts` (slice 3). JSON is camelCase:

```
Assignee            { id: bigint; displayLogin; avatarUrl; slug; nodeId }
PullRequestLabel    { id: bigint; name; color; description; nodeId }
Participant         { id: bigint; displayLogin; avatarUrl; profilePath; slug }
LinkedIssue         { id: bigint; number; title; url; state: IssueState;
                      stateReason: IssueStateReason; repository?: {owner, name} }
Deployment          { status: DeploymentStatusState; name; deploymentUrl; workflowUrl;
                      author?: {login, avatarUrl}; timestamp; commitOid; commitShortSha }
ReviewRequestsResponse { pendingReviewRequests: PendingReviewRequest[]; completedReviews: CompletedReview[];
                         copilotReviewer?: Reviewer; copilotReviewerRow?: CopilotReviewerRow }
PendingReviewRequest   { reviewer?: Reviewer; isCodeOwner; isCodeOwnerFromDelegation;
                         deferredType: DeferredType; delegatedFromTeam?: Reviewer; createdAt;
                         requestedCopilotReviewEffort: CopilotReviewEffort }
CompletedReview        { id: bigint; reviewer?: Reviewer; state: ReviewState; headSha; submittedAt;
                         hasWriteAccess; canReRequest; onBehalfOfTeams: Reviewer[];
                         dismissedReviewState: ReviewState }
Reviewer               { id: bigint; displayLogin; name; avatarUrl;
                         reviewerType: "User"|"Team"; organizationLogin; slug }
```

Enum wire values: `REVIEW_STATE_{UNSPECIFIED,PENDING,COMMENTED,APPROVED,CHANGES_REQUESTED,DISMISSED}`,
`DEFERRED_TYPE_{UNSPECIFIED,CODEOWNER,COPILOT}`,
`COPILOT_REVIEW_EFFORT_{UNSPECIFIED,LOW,MEDIUM,HIGH}`.

A proto response carries `X-Proto-JSON: true`. The client then decodes with `fromJson(schema, …)`;
otherwise a legacy adapter runs (**read**, `packages/react-core/future/query-fn-fetch.ts`, slice 1).

### Writes

#### Create a review comment

| | |
| --- | --- |
| path | `POST BASE/page_data/create_review_comment` |
| headers | `Accept: application/json` |
| response | `{thread: Thread, comment: Comment, totalCommentsCount: number}` |
| evidence | **read** — `packages/pull-requests/mutations/use-create-review-comment-mutation.ts` (slice 2). Also the one route with prior public documentation; see [What is documented nowhere else](#what-is-documented-nowhere-else). |

```ts
export type Side = 'left' | 'right'
export type CreateReviewCommentMutationData = {
  text: string
  line?: number
  path: string
  positioning?: LineCommentPosition | MultilineCommentPosition | FileCommentPosition
  side?: Side
  startLine?: number
  startSide?: Side
  subjectType?: CommentSubjectType   // 'line' | 'multiline' | 'file'
  submitBatch?: boolean
  comparisonStartOid?: string | null | undefined
  comparisonEndOid?: string | null | undefined
}

interface LineCommentPosition      { baseCommitOid; headCommitOid; type: 'line';      line: number; path: string; commitOid: string }
interface MultilineCommentPosition { baseCommitOid; headCommitOid; type: 'multiline'; startPath; startLine; startCommitOid; endPath; endLine; endCommitOid }
interface FileCommentPosition      { baseCommitOid; headCommitOid; type: 'file';      path: string; commitOid: string }
```

`submitBatch: true` publishes immediately and clears the pending review. `submitBatch: false` adds
the returned thread id to the pending review. `undefined` does neither.

Reply form, same route, different body (**measured**, `…/use-create-reply-comment-mutation.ts`: a reply
with `inReplyTo` set to the database id as a number, `submitBatch: true`, the thread's `path` and both
oids answered 200 and landed in the same thread):

```ts
{text, inReplyTo: number|null|undefined, submitBatch?: boolean, path: string,
 comparisonStartOid?, comparisonEndOid?}
```

The comment lands in the **cookie account's** pending review. Nothing in the request names the
account. If you drive this with one identity's cookie and submit the review with another's token,
the review silently splits in two — recorded by the tarantool tool, see the risk section.

#### Update a review comment

| | |
| --- | --- |
| path | `PUT BASE/page_data/update_review_comment` |
| body | `{body: string, commentId: string}` |
| query | `body_version=<bodyVersion>` optional |
| response | **read**: `{body, bodyHTML, bodyVersion, commentDatabaseId: number, threadId: number}`. **measured**: `{"bodyVersion":"<sha>"}` — unresolved |
| evidence | **read** — `…/use-update-review-comment-mutation.ts` (slice 2); **measured** |

#### Delete a review comment

| | |
| --- | --- |
| path | `DELETE BASE/page_data/review_comments/:commentDatabaseId` |
| body | none |
| response | 204 or 200 on success, JSON error body otherwise. **measured: 204, comment gone.** |
| evidence | **read** — `…/use-delete-review-comment-mutation.ts` (slice 2), which builds the literal string by hand. Slice 2 notes it is the only literal `page_data/` string in its 64 bundles. The registry entry is **commented out** (slice 5). **measured** |

#### Resolve and unresolve a thread

| | |
| --- | --- |
| path | `POST BASE/page_data/resolve_thread` |
| body | `{threadId: string, resolution_reason: string \| undefined}` — **camelCase and snake_case in the same object** |
| response | `{"message":"Thread was successfully resolved."}` (**measured**). The client reads nothing but the status. |
| evidence | **read** — `…/use-resolve-thread-mutation.ts` (slice 2); **measured** |

| | |
| --- | --- |
| path | `POST BASE/page_data/unresolve_thread` |
| body | `{threadId: string}` |
| evidence | **read** — `…/use-unresolve-thread-mutation.ts` (slice 2) |

`page_data/resolve_review_thread` does not exist — 422 with an HTML error page (**measured**).

#### Submit and abandon a review

| | |
| --- | --- |
| path | `PUT BASE/page_data/submit_review` |
| body | `{body: string, event: 'approve' \| 'comment' \| 'request changes', headSha: string}` |
| | **`'request changes'` has a space in it.** Not `request_changes`, not `REQUEST_CHANGES`. |
| response | `ReviewResponse`; errors arrive as `json.error` |
| evidence | **read** — `…/mutations/use-submit-review-mutation.ts` (slice 4) |

| | |
| --- | --- |
| path | `DELETE BASE/page_data/abandon_review` |
| body | none; `Accept: application/json` |
| response | `ReviewResponse` |
| evidence | **read** — `…/mutations/use-abandon-review-mutation.ts` (slice 4) |

#### Mark a file viewed

| | |
| --- | --- |
| path | `POST BASE/file_review` (mark) / `DELETE BASE/file_review` (unmark) |
| body | mark: `{path: string, viewed: 'viewed'}`. Unmark: `{path: string, _method: 'delete'}` **and** HTTP DELETE — the Rails `_method` override rides inside the JSON body |
| headers | `Accept: application/json` |
| errors | `json.error`, `cause` is the status |
| evidence | **read** — `…/mutations/use-update-file-viewed-status-mutation.ts` (slice 4) |

Not a `page_data` route.

#### Suggested changes

Two routes, two shapes, easy to confuse:

| | `apply_suggestions` | `apply_review_suggestions` |
| --- | --- | --- |
| TS key | `submitSuggestedChanges` | `applySuggestedChanges` |
| method | POST | POST |
| body | `{changes: SuggestedChange[], currentOid: string, message: string}` | `{comments: [{id: number, suggestionIndex?: number}], message: string, expectedHeadOid: string}` |
| headers | — | `Idempotency-Key: <operationId>`; comments are sorted before the key is hashed |
| conflict | — | `409` or `json.code === 'HEAD_OID_MISMATCH'` |
| after | client reloads the page | — |
| evidence | **read**, `…/use-submit-suggested-changes-mutation.ts` (slice 2) | **read**, `…/use-apply-batched-suggestions-mutation.ts` and `…/use-apply-unified-batch-suggestions-mutation.ts` (slice 4) |

```ts
export type SuggestedChange = {
  authorLogin: string
  commentId: string
  commentDatabaseId: number | null | undefined
  path: string
  suggestion: string[]
  threadId: number | null | undefined
  lineRange: {startLineNumber: number; startOrientation: 'LEFT'|'RIGHT'
              endLineNumber: number; endOrientation: 'LEFT'|'RIGHT'}
  suggestionIndex: number
}
```

#### Comment visibility and reactions

| path | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/page_data/hide_comment` | POST | `{classifier: string, commentId: number}` — `commentId` is the **database** id. Response `{commentDatabaseId, threadId, reason}` | **read**, `…/use-hide-comment-mutation.ts` (slice 2) |
| `BASE/page_data/unhide_comment` | POST | `{commentId: number}`, same response shape | **read**, `…/use-unhide-comment-mutation.ts` (slice 2) |
| `BASE/page_data/add_comment_reaction` | POST | see below | **read**, two slices, two bodies |
| `BASE/page_data/remove_comment_reaction` | POST | same as add; which one is called is decided by `viewerHasReacted` | same |

**Unresolved — the reaction body.** Two slices read two different field names for the same route:

| source | body |
| --- | --- |
| `packages/pull-requests/mutations/use-react-to-comment-mutation.ts` (slice 2) | `{reaction: string, commentId: number}` — review comments, database id |
| `packages/pull-requests/mutations/use-react-to-issue-comment-mutation.ts` (slice 4) | `{reaction: ReactionContent, issueCommentId: string}` — timeline comments |

Both are literal reads. Most likely the route accepts either key and dispatches on which arrived,
but that is a guess. Response in both readings: `{reactionGroups: ReactionViewerGroup[]}`.

#### Description, title, timeline comment

| path | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/page_data/update_description` | **PATCH** | `{body: string}`. The source notes the endpoint does **not** accept `body_version`, so stale edits go undetected. Response `DescriptionData` | **read**, `…/use-update-description-mutation.ts` (slice 4) |
| `BASE/page_data/create_timeline_comment` | POST | `{text}` or `{text, closePullRequest: true}` or `{text, reopenPullRequest: true}` — mutually exclusive. `Accept: application/json` | **read**, `…/use-create-pull-request-timeline-comment-mutation.ts` (slice 4) |
| `BASE/page_data/update_title` | not read | not read | name only, from the registry (slice 5) |

`create_timeline_comment` response: `{message: string, commentId: number, issueComment: IssueComment}`,
where `IssueComment {id, relayId, authorAssociation, authorAvatarUrl, isAgent?, authorLogin, body,
bodyHtml, createdAt, isHidden, minimizedReason, publishedAt, repository, url}`.

#### Reviewers, assignees, labels

| path | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/page_data/modify_reviewers` | POST | `{addReviewers: ReviewerModification[], removeReviewers: ReviewerModification[]}`, `ReviewerModification = {reviewerId: number, isTeam: boolean, reviewEffortLevel?: 'low'\|'medium'\|'high'}`. `Accept: application/json` | **read**, `…/use-modify-reviewers.ts` (slice 4) |
| `BASE/page_data/re_request_review_from_user` | POST | slice 4: `{reviewerId?: number}` **or** `{reviewerLogin?: string}`, plus optional `review_effort_level: 'low'\|'medium'\|'high'` — **camelCase ids beside a snake_case effort level in one body**. Slice 5, from the mergebox hook: `{reviewerLogin: string}` | **read** ×2, different call sites |
| `BASE/page_data/modify_assignees` | POST | `{addAssignees: string[], removeAssignees: string[]}` — global relay node ids | **read**, `…/use-modify-assignees.ts` (slice 4) |
| `BASE/page_data/modify_labels` | POST | `{addLabels: string[], removeLabels: string[]}` | **read**, `…/use-modify-labels.ts` (slice 4) |

#### Merge, queue, branch

**read** — `packages/mergebox/hooks/mutations/*` (slice 5). All POST unless stated.

| route | body |
| --- | --- |
| `merge` | `{authorEmail?, commitMessage?, commitTitle?, mergeMethod: string, bypassBranchProtections?: boolean}` |
| `enable_auto_merge` | `{authorEmail?, commitMessage?, commitTitle?, mergeMethod?: string}` |
| `disable_auto_merge` | none |
| `enqueue_stack` | async-merge form: `{mergeAction}` when `mergeAction === 'MERGE_QUEUE'`, else `{mergeAction, mergeMethod, commitTitle?, commitMessage?, authorEmail?, bypassRules: 'true'\|'false'}` — **`bypassRules` is a stringified boolean**. Separate hook sends `{authorEmail?, bypassBranchProtections?: boolean, commitMessage?, commitTitle?, mergeMethod}` — **a real boolean under a different key** |
| `dequeue_pull_request` | none |
| `update_pull_request_branch` | `{updateMethod: string, expectedHeadOid: string}` → `{orchestration: {url}}`, then poll that url (202 = keep going, 1 s ×1.5) and read `orchestration.error_message` |
| `stack_rebase` | `{expectedHeadOids: Record<prNumber, headOid>}`, merged PRs omitted |
| `mark_ready_for_review` | `{review_effort_level?, review_effort_level_selected?, review_effort_snapshot?, review_effort_client_version?}` — **all snake_case** |
| `convert_to_draft`, `close_pull_request`, `reopen_pull_request`, `delete_head_ref`, `restore_head_ref`, `cleanup_codespaces`, `run_action_required_workflows`, `generate_change_groups` | none |
| `update_merge_box_user_preference` | `{preferenceName: string, preference: string}`. Client-side whitelist: `preferenceName: 'status_checks_grouping_preference'`, `preference ∈ {'grouped_by_status', 'ungrouped'}` |

`enqueue_stack` returns one of:

```ts
| {status: 'pending';  message: string; uuid: string}
| {status: 'merged';   message: string; sha: string}
| {status: 'enqueued'; message: string}
| {status: 'failed';   error: string}
```

A `409` still carries a usable `status`/`uuid`. The client then polls
`page_data/merge_request_status/:uuid` (1000 ms initial, ×1.5 backoff, 600 s timeout).

#### View preferences

| route | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/page_data/update_whitespace_preference` | POST | `{w: 1 \| 0}` — **a number, not a boolean**. Response `{ignoreWhitespace: boolean}` | **read**, slice 4 |
| `BASE/page_data/update_show_change_groups_preference` | POST | `{show_change_groups: 'true' \| 'false'}` — **snake_case key, string-valued boolean**; `Content-Type: application/json` set explicitly. Response `{showChangeGroups: boolean}` | **read**, slice 4 |
| `/users/diffview` | POST | `{commentsPreference?, lineSpacing?, diff?}`. The argument is named `splitPreference`, the wire field is `diff`. Values: `diff` ∈ `'unified'\|'split'`, `lineSpacing` ∈ `'compact'\|'relaxed'`. Guarded by `isLoggedIn()`. Errors `{error: string}` | **read**, `packages/diff-view-settings/hooks/mutations/use-update-user-diff-view-preference-mutation.ts` (slice 1) |
| `/users/:login/pulls/settings/file_tree_visibility` | PUT | `FormData` `file_tree_visible = "true"\|"false"`; `Accept: application/json` | **read**, `packages/commits/shared/use-update-user-tree-preference.ts` (slice 1); path helper confirmed in `packages/paths/path.ts` (slice 3) |
| `BASE/page_data/update_file_tree_width_preference` | POST | `FormData` `file_tree_width=<number>`; `Accept: application/json` | path **read** in `packages/paths/path.ts` (slice 3); method and body **read** at the call site (slice 1). **Absent from the registry.** |
| `BASE/page_data/update_docked_panel_width_preference` | POST | `FormData` `docked_panel_width=<number>`; `Accept: application/json` | path **read** (slice 3), call site **read** (slice 4). **Absent from the registry.** |

#### Stacks

| route | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/page_data/pull_request_stacks` | POST | `{pullRequestIds: number[], stackId?: number}` — ordered bottom-of-stack first. Response `{stackNumber: number}` | **read**, `…/use-create-stack-or-append-mutation.ts` (slice 4) |
| `BASE/page_data/pull_request_stacks/:stackId` | **DELETE** | none | **read**, `…/use-unstack-pull-requests-mutation.ts` (slice 4) |

#### Non-`page_data` PR writes

| path | method | body | evidence |
| --- | --- | --- | --- |
| `BASE/reviews/:id/update` | PUT | `FormData`: `pull_request_review[body]`, `body_version`. Response `{source, body, newBodyVersion, editUrl}`; a stale edit returns `{stale: true, updated_markdown, updated_html, version}` and is thrown as `StaleContentError` | **read**, `…/use-update-review-summary-mutation.ts` (slice 4) |
| `/:owner/:repo/issue_comments/:id` | PUT | `FormData`: `issue_comment[body]`, `body_version`. Same response shape. **Repo-scoped, not PR-scoped** | **read**, `…/use-update-issue-comment-mutation.ts` (slice 4) |
| `/:owner/:repo/issue_comments/:id` | DELETE | none; `Accept: application/json` | **read**, slice 4 |
| `BASE/revert` | POST | none; follows `response.url` on success | **read**, `…/RevertPRAction.tsx` (slice 4) |
| `BASE/run_workflows` | POST | none | **read**, `packages/commit-checks-status/hooks/use-approve-workflows.ts` (slice 5) |
| `BASE/code_review_fix_with_copilot` | POST | `{create_pull_request: boolean, fix_all: boolean, review_references, is_batch?: true, model?: string, additional_instructions?: string}` | **read**, `packages/copilot-fix-controls/use-fix-with-copilot.ts` (slice 2) |
| `/preview` | POST | `FormData`: `text`, `issue`, `repository`, `project`, `path?`, `line_number?`, `start_commit_oid?`, `end_commit_oid?`, `base_commit_oid?`, `subject?`, `start_line_number?`, `subject_type?` (`Issue\|PullRequest\|Project`). Returns **HTML** — the diff-comment markdown preview | **read**, `packages/comment-box/api/preview.ts` (slice 5) |
| `/:owner/:repo/pulls/_bulk_update` | POST | `{issues: number[] /* PR numbers */, ...update}` → `{job: {url}}`, then poll with `Accept: application/json`; cross-origin job urls are refused | **read**, `…/helpers/repo-pulls-bulk-update.ts` (slice 4) |
| `/:owner/:repo/pulls/_deferred` | GET | `q`, `page`, `milestone?`, repeated `pr_ids[]` — **snake_case brackets** | **read**, `…/hooks/use-repo-pulls-dashboard.ts` (slice 4) |

#### Automated (Copilot / code-scanning) review threads

Path helpers live in `@github-ui/paths`, which was in no slice; only the helper names and arguments
were **read** (`packages/pull-requests/mutations/*`, slice 2).

| helper | method | body |
| --- | --- | --- |
| `pullRequestDismissAutomatedReviewCommentPath({basePath, automatedReviewCommentId})` | PUT | `{reason: string, resolution_note: string \| undefined}` |
| `pullRequestReopenAutomatedReviewCommentPath({basePath, automatedReviewCommentId})` | PUT | none |
| `pullRequestFeedbackAutomatedReviewCommentPath({basePath, automatedReviewCommentId})` | path only, handed to a form or link | — |

Dismiss response, behind flag `automated_review_comment_effective_dismissal_state`, is either the
legacy `{message: string}` or:

```ts
{
  thread: {isResolved: boolean, resolvedBy: string | null},
  automatedComment: {
    isDismissed: boolean
    dismissalReason: string | null
    dismissedBy: string | null
    delegatedDismissalRequest: null | {requester: string, reason: string|null,
      status: 'PENDING'|'APPROVED'|'REJECTED'|'CANCELLED', reviewer: string|null}
    viewerCanDismiss: boolean
    viewerCanReopen: boolean
  }
}
```

#### Copilot code-review findings

All relative to `BASE`. **read** — `packages/copilot-findings/*` (slice 4).

| path | method | body |
| --- | --- | --- |
| `BASE/code_review_findings` | GET | — . `404` plus a `Retry-After` header means "not ready, poll again"; the header drives the refetch interval. Response `FindingsPayload {findings, currentFreshness, headSha, modelsUrl, mergeReadiness, showFeedbackBanner, feedbackBannerDismissPath, sweAgentEnabled, dotcomChatEnabled, canApplySuggestion, maxFindingBatchSize}` |
| `BASE/code_review_findings/ignore` | POST | `{entities: [{id: string, partitionRef}], resolved_reason: FindingResolvedReason}` — **camelCase `partitionRef` inside a snake_case body** |
| `BASE/code_review_findings/ignore` | DELETE | `{entities: [{id, partitionRef}]}` — reopen |
| `BASE/code_review_findings/apply_suggestions` | POST | `{findings: [{id, partitionRef}], expected_head_sha: string, commit_message: string}` → `{commit_oid, finding_ids}`. `409` or `code ∈ {HEAD_OID_MISMATCH, SUGGESTION_CONFLICT}` on conflict |
| `BASE/code_review_findings/fix` | POST | `{create_pull_request: boolean, expected_head_sha: string, findings: [{id, partitionRef}], instructions?: string, model?: string}` — `model` omitted when `'auto'`. Response `{task_url, task_id, finding_ids}` |
| `BASE/code_review_findings/feedback` | POST *(inferred)* | path is built in `FindingsList.tsx`; the submitting component is in no slice |

Copilot review feedback on a single comment (**read**, `packages/copilot-review-feedback/*`, slice 3):
POST to the backend-supplied `feedbackPath`, else `<commentUrl without hash>/code_review_feedback`,
`FormData`, all **snake_case**: `comment_id`, `feedback`, optional `feedback_details_only=1`,
repeated `feedback_choice[]`, optional `text_response`.

### Client routes and page payloads

**read** — `packages/pull-requests/routes/*` (slice 3).

```
/:owner/:repo/pull/:n                 index: Conversation, or Overview under prs_overview_as_index_route
/:owner/:repo/pull/:n/overview
/:owner/:repo/pull/:n/commits
/:owner/:repo/pull/:n/commits/:range
/:owner/:repo/pull/:n/changes
/:owner/:repo/pull/:n/changes/:range
/:owner/:repo/pull/:n/checks
/:owner/:repo/pull/:n/files           deprecated; kept for react partials on the Rails page
/:owner/:repo/pull/:n/findings
/:owner/:repo/pull/:n/walkthrough
/:owner/:repo/pull/:n/file_metadata/:baseSha/:headSha
```

`/files` became `/changes`. That one rename broke another extension for eight months; see
[Stability and risk](#stability-and-risk).

Page payload routes (GET, JSON):

```
/:owner/:repo/pull/:n/_layout                       layout payload
/:owner/:repo/pull/:n?overview=false                conversation payload
/:owner/:repo/pull/:n?overview=true                 overview payload
/:owner/:repo/pull/:n/partials/body
/:owner/:repo/pull/:n/partials/timeline
/:owner/:repo/pull/:n/partials/sidebar
/:owner/:repo/pull/:n/partials/timeline_actions
/:owner/:repo/pull/:n/partials/checks_partial
/:owner/:repo/pull/:n/partials/processing_indicator
```

`withOverviewParam` appends `?overview=true|false` to the main route so a soft-nav refetch cannot
swap the Conversation payload shape for the Overview one.

**Any React page URL returns its own JSON payload** when fetched with the right headers
(**read**, `packages/react-core/JsonRoute.tsx`, slice 1):

```ts
window.fetch(`${location.pathname}${location.search}`, {
  headers: {
    Accept: 'application/json',
    ...getBaseFetchHeaders(),
    'X-GitHub-Target': 'dotcom',
    'X-React-Router': 'json',
    ...getAppTypeHeader('navigator'),
  },
})
```

Data-router route payloads come back as `{payload: {"<routeId>": <data>}}`.

Feature flags read in `routes/create-pull-requests-routes.tsx`: `prs_overview_as_index_route`,
`react_data_router_pull_request_files`, `repo_pulls_dashboard_surface`.

### Anchors

Not HTTP, but needed to address a comment (**read**, `packages/diffs/document-hash-helpers.ts` and
`packages/paths/path.ts`, slice 3):

```
#diff-<hex>(L|R)<n>[-(L|R)<n>]        #discussion-diff-<id>(L|R)<n>…
#r<reviewCommentDatabaseId>           #annotation_<id>
#issue-<id>                           #issuecomment-<id>
#pullrequestreview-<id>               #discussion_r<id>
```

### Live updates

The merge box and status checks subscribe to Alive WebSocket channels rather than polling
(**read**, `packages/mergebox/hooks/use-mergeability-live-updates.ts`, slices 1 and 3 — identical
channel lists):

`stateChannel`, `deployedChannel`, `reviewStateChannel`, `workflowsChannel`, `mergeQueueChannel`,
`headRefChannel`, `baseRefChannel`, `gitMergeStateChannel`, `pullRequestChannel`,
`codeScanningChannel`, `commitHeadShaChannel`, `proofOfPresenceChannel`.

Channel names are server-supplied signed strings that arrive on the page-data payloads. Message
payload is `{wait?: number}` — milliseconds to delay the refetch for replication lag. Refetch is
throttled, 2000 ms by default.

Protocol (**read**, `@github/alive-client/dist/alive-session.js`, slice 1):

- Socket URL matches `/\/u\/(\d+)\/ws/`; query params on connect are `shared=<bool>` and
  `p=<presenceId>.<connectionCount>`.
- Client → server: `{"subscribe": {"<signedTopic>": "<offset>"}}`, batched 25 at a time. For
  presence channels the value is `JSON.stringify(channelMetadata)` instead of an offset.
  Unsubscribe: `{"unsubscribe": ["<signedTopic>", …]}`.
- Server → client: `{"e":"ack","off":<offset>}` and
  `{"e":"msg","ch":"<channel>","off":<offset>,"data":{…}}`.
- Close reason `"Alive Redeploy"` triggers a randomized 3–25 minute reconnect.

`fetchRefreshUrl(url)` POSTs with `GitHub-Verified-Fetch: true` and `mode: 'same-origin'` to get a
fresh socket URL; the response body is the URL as plain text.

### Error handling

**read** — `packages/pull-request-page-data-tooling/utils/fetch-error-handling.ts` (slice 5) and
`packages/react-core/future/response-error.ts` (slice 1).

- Error body shape: `{error?: string, metadata?: {ruleErrors?: [...]}}`.
- A non-2xx body containing `{stale: true}` is a stale-content conflict, and the body itself is the
  fresh data (`throwIfStaleResponse`).
- Reads go through `fetchWithTracing`, where **HTTP 401 is treated as SSO-expired** and the cached
  previous data is returned instead of throwing.
- Status mapping: 406 `NotAcceptableError`, 429 `RateLimitError`, 503 `ServiceUnavailableError`,
  410/418/proxy-blocked-403 `NoiseError`, other 401/403 `DataRouterAuthError`.
- `X-Reject-Reason: csrf` on a 403 distinguishes a CSRF rejection from any other.
- `X-GitHub-Version-Mismatch` / `X-GitHub-Server-Version` signal a client/server version skew.
- `X-Github-Request-Id` is on every response and worth logging.

---

## Casing traps

The whole list, in one place. Every row is **read** in source unless marked.

| route | trap |
| --- | --- |
| `resolve_thread` | `{threadId, resolution_reason}` — camelCase and snake_case in one object. `thread_id` returns 404 (**measured**) |
| `submit_review` | `event: 'request changes'` — with a space |
| `thread_preview_positioning` | `?thread_ids=` — snake_case, comma-joined |
| `review_menu` | `?threadIds[]=` — camelCase, repeated brackets. The opposite of the row above |
| `merge_box`, `stack_mergeability` | `?merge_method=&bypass_requirements=` — snake_case query on routes whose bodies are camelCase |
| `update_show_change_groups_preference` | `{show_change_groups: 'true'}` — snake_case key, string-valued boolean |
| `update_whitespace_preference` | `{w: 1}` — a number, not a boolean, not a string |
| `enqueue_stack` | `{bypassRules: 'true'}` in one hook, `{bypassBranchProtections: true}` in another. Different key, different type, same route |
| `mark_ready_for_review` | all snake_case: `review_effort_level`, `review_effort_level_selected`, `review_effort_snapshot`, `review_effort_client_version` |
| `re_request_review_from_user` | `{reviewerId}` / `{reviewerLogin}` camelCase beside `review_effort_level` snake_case, in one body |
| `submit_copilot_groups_feedback` | `{feedback, text_response?, feedback_choice?}` — snake_case |
| `code_review_findings/ignore` | `{entities: [{id, partitionRef}], resolved_reason}` — camelCase inside snake_case |
| `code_review_findings/fix` | `{create_pull_request, expected_head_sha, findings, instructions?, model?}` — snake_case, while `apply_review_suggestions` on `page_data` uses `expectedHeadOid` camelCase for the same concept |
| `file_review` | `{path, _method: 'delete'}` — a Rails method override inside a JSON body, sent alongside a real HTTP DELETE |
| `add_comment_reaction` | `commentId` (number) or `issueCommentId` (string) depending on the comment type. Unresolved |
| `hide_comment` | `commentId` is the **database** id, a number. `update_review_comment`'s `commentId` is a string |
| `/users/diffview` | the argument is `splitPreference`, the wire field is `diff` |
| `_deferred` | `?pr_ids[]=` snake_case brackets, next to `review_menu`'s `threadIds[]` |
| `diff_entry_lines` | the TS key is `diffContextLines`; the route is not `diff_context_lines` |
| `user_diff_view_settings` | the TS key is `diffViewUserSettings`; the words are in the other order on the wire |
| `stacks` | the TS key is `stack`, singular; the route is plural |
| `pull_request_stacks` | one route name for two TS keys, `createStackOrAppend` and `unstackPullRequests` |
| `apply_suggestions` vs `apply_review_suggestions` | `submitSuggestedChanges` maps to the first, `applySuggestedChanges` to the second. Different bodies |
| `catch_up` | the TS key is `activity` |
| `reviewers` | the TS key is `availableReviewers` |
| `create_timeline_comment` | the TS key is `submitPullRequestTimelineComment` |

---

## Everything else

Terser. These were not the point of the exercise, but they were in the same bundles.

### Comment box and markdown editor

**read** — `packages/comment-box/*` (slice 1).

| path | method | notes |
| --- | --- | --- |
| `/suggestions/:subjectType[/:subjectId]?mention_suggester=1&user_avatar=1[&repository_id=<n>]` | GET | `MarkdownSuggestedMention[]` |
| `/suggestions/:subjectType[/:subjectId]?issue_suggester=1&repository_id=<n>` | GET | `{icons: {[refType]: svg}, suggestions: MarkdownSuggestedReference[]}` |
| `/settings/replies[?context=issue\|pull_request]` | GET | `[{id, title, body, default}]` |
| `/:nwo/attachment_accessibility_check?guids[]=<uuid>…` | GET | `{inaccessible: string[]}`. Gated on flag `warn_inaccessible_attachments`, debounced 500 ms |
| `/:nwo/slash_apps?surface=<surface>[&subject_gid=<globalRelayId>]` | GET | loaded by `<slash-command-expander>` |
| `/autocomplete/emojis_for_editor` | GET | `Record<name, [url, character]>` |

`subjectType` is exactly `'issue' \| 'pull_request' \| 'project' \| 'commit'`, after a mapping:
`issue_comment → issue`; `pull_request_comment`, `pull_request_body → pull_request`.
`subjectId` is `subject.id.databaseId?.toString() ?? subject.id.id` — the numeric database id is
preferred over the GraphQL global id. `slash_apps`' `surface` is the subject type except `issue`,
which becomes `issue_body`.

### Uploads

Three steps. **read** by two slices independently (`packages/attachments/lib/uploadable-assets.ts`,
slice 2; `packages/comment-box/api/file-upload.ts` and `packages/batch-upload/*`, slices 4 and 5).
Also the one flow with published prior art.

1. `POST /upload/policies/assets` — `FormData` `{name, size, content_type}`, optional
   `repository_id`, optional `upload_container_type='project'` + `upload_container_id`. Returns an
   `UploadPolicy` with `upload_url`, `asset_upload_url`, `form`, `upload_authenticity_token`,
   `asset_upload_authenticity_token`.
2. `POST <policy.upload_url>` — off-origin storage. `FormData` of `policy.form` plus `file`, plus
   `authenticity_token = policy.upload_authenticity_token` when `policy.same_origin`. Expects 204.
   `credentials: 'include'` on Enterprise, `'same-origin'` otherwise.
3. `PUT <policy.asset_upload_url>` — `FormData` `authenticity_token = policy.asset_upload_authenticity_token`,
   `Accept: application/json`. Returns the asset JSON.

Copilot chat attachments use the policy path `/upload/policies/copilot-chat-attachments`.

### Issues

**read** — slices 2, 3 and 5. Nearly all of these are persisted GraphQL behind a Rails path: an
ordinary URL with `?queryId=<hash>`, returning a GraphQL envelope `{data?, errors?: [{message}]}`.

Comments and edit history:

| path | method | body |
| --- | --- | --- |
| `/:owner/:repo/issues/:n/comments.json?queryId=<addCommentMutation>` | POST | `{input: {body}}` |
| `…/comments/:databaseId.json?queryId=<updateIssueCommentBodyMutation>` | PATCH | `{input: {body, bodyVersion}}` |
| `…/comments/:databaseId.json?queryId=<deleteIssueCommentMutation>` | DELETE | — |
| `/:owner/:repo/comments/minimization?queryId=<minimizeCommentMutation>` | PUT | `{input: {subjectId, classifier}}` |
| `/:owner/:repo/comments/minimization?queryId=<unminimizeCommentMutation>` | DELETE | `{input: {subjectId}}` |
| `/:nameWithOwner/comments/pin` | PUT / DELETE | `{input: {issueCommentId}}` |
| `/:owner/:repo/comments/abuse_report?queryId=<submitAbuseReportMutation>` | POST | `{comment_id, reason}` — **snake_case `comment_id`** |
| `/user_content_edits/edit_history/:commentId?queryId=<CommentEditHistory>` | GET | — |
| `/user_content_edits/edit_history_metadata/:commentId?queryId=<MarkdownEditHistoryMetadataServerQuery>` | GET | — |
| `/issues/edit-history-dialog?id=<userContentEditId>&queryId=<EditHistoryDialogQuery>` | GET | — |

Lifecycle and metadata all go through one helper,
`submitIssueLifecycleMutation({path, method, queryId, input})`, which calls:

```ts
reactFetchJSON(`${path}?queryId=${queryId}`, {method, body: input ? {input} : undefined})
```

| path | method | body |
| --- | --- | --- |
| `/:owner/:repo/issues/:n.json` | DELETE | — |
| `/:owner/:repo/issues/:n/transfer.json` | POST | `{input}` |
| `/:owner/:repo/issues/:n/discussion.json` | POST | `{input}` |
| `/:owner/:repo/issues/:n/pin?queryId=…` | PUT / DELETE | — |
| `/:owner/:repo/issues/:n/title` | PUT | `{title}` |
| `/:nameWithOwner/issues/:n/conversation_lock` | PUT / DELETE | `{lockReason}` / — |
| `/:nameWithOwner/issues/:n/subscription?queryId=<updateIssueSubscriptionMutation>` | PUT | `SubscriptionUpdate` |
| `/:owner/:repo/issues/:n/parent.json?queryId=<setParentMutation>` | PUT | `{issueId: parentIssueId}` |
| `/:owner/:repo/issues/:n/sub_issues?queryId=<addSubIssueMutation>` | POST | `{input: {subIssueId, replaceParent}}` |
| `/:owner/:repo/issues/:n/sub_issues?queryId=<removeSubIssueMutation>` | DELETE | `{input: {subIssueId}}` |
| `/:owner/:repo/issues/:n/field_value.json?queryId=…` | POST / PATCH / DELETE | `{issueField}` / `{issueField}` / `{fieldId}` |
| `/:owner/:repo/issues/:n/pending_suggestions.json?queryId=…` | PUT / DELETE | `{actorId, suggestions: [...]}` |
| `<issueUrl>/unmark_duplicate` | POST | `{duplicateId, canonicalId, queryId}` — **`queryId` in the body, not the query string** |

Relationships: `/:owner/:repo/issues/:n/relationships/{blocking,blocked_by}.json` GET with
`page_size`, `queryId`, `cursor`; POST `{blockingIssueId}` / `{issueId}`; DELETE.
`/:nameWithOwner/issues/:n/relates_to.json` POST/DELETE `{relatedIssueId}`.

Index and rows: `/:owner/:repo/issues/_layout`, `/:owner/:repo/issues` (`q`, `page`),
`/:owner/:repo/issues/deferred`, `/:owner/:repo/issues/_rows?ids=<csv>&fetch_reactions=<bool>`.

Bulk: `POST /_ghui/item-pickers/bulk_actions` with `{...target, ...update}` where target is
`{ids: string[]}` (1–1000) or a query form → `{job: {id}}`; then
`GET /_ghui/item-pickers/bulk_actions/:jobId` → 202 `{job: {state: PENDING|QUEUED|STARTED,
percentage, execution_errors: [{node_id}]}}`, 200 done, 404/410 missing, 500 `{job: {error_message}}`.

Item pickers, all `/_ghui/item-pickers/<endpoint>` with `queryId`:
`assignees`, `labels`, `labels/suggestions`, `issue_types`, `issue_single_select_field_options`,
`issue_multi_select_field_options`, `milestones`, `projects`, `top_repositories`,
`repositories_search_full`, `bulk_actions`. Responses are GraphQL-shaped even though the route
is REST-ish.

Filter suggestions: `/_filter/{issues,labels,languages,milestones,projects,teams,users,repositories,organizations,issue_fields}`
each with a matching `…/validate`. GET, `Accept: application/json`, `mode: 'same-origin'`, plain
`fetch` with no verified-fetch header.

Saved views: `/:owner/:repo/issues/views.json` GET, `…/views/:id.json` GET/PUT/DELETE,
`…/views/:id/pinned.json` PUT `{pinned: boolean}` (error code `pinned_limit_exceeded`),
`/users/shortcuts[/:id]` POST/PUT/DELETE `{view: <shortcut>}`. Error envelope
`{error: {message, code}}`.

Preheat: `GET /:owner/:repo/issues/preheat?number=&source=&query=IssueViewerPage&version=1&queryId=<hash>`
with header `X-GITHUB-PREHEAT: <source>`.

### Reactions (generic)

`POST` to add, `DELETE` to remove, `/reactable_item/reactions`, body `{subjectId, content}`,
GraphQL-shaped response. **read**, `packages/reaction-viewer/mutations/reaction-mutation.ts` (slice 2).

### Repository

**read** — slices 1, 3, 4.

| path | method | notes |
| --- | --- | --- |
| `/:owner/:repo/refs?type=branch\|tag` | GET | `{refs: string[], cacheKey: string}` |
| `/:owner/:repo/tree-list/:commitOid[?include_directories=true]` | GET | `{paths: string[], directories: string[]}` |
| `/:owner/:repo/recently-touched-branches` | GET | deferred query |
| `/:owner/:repo/branch-and-tag-count` | GET | deferred query |
| `/:owner/:repo/_sidebar/about` | GET | `SidebarAboutResponse & HeaderResponse` |
| `/:owner/:repo/commits/_layout`, `/:owner/:repo/pulls/_layout`, `/:owner/:repo/issues/_layout` | GET | data-router layout payloads |
| `/:owner/:repo/diffs/:entry/diff-lines?sha1=&sha2=` | GET | |
| `/:owner/:repo/diffs?commit=<oid>&sha2=[&sha1=]` | GET | |
| `/:owner/:repo/commit/:oid/status-details` | GET | |
| `/:owner/:repo/codeowners-validity/:commitish/:path` | GET | `CodeownersError[]` |
| `/:owner/:repo/toggle_generic_feature` | POST | `FormData` `feature_name`, optional `enabled`, optional `reason`. Names seen: `prx_files`, `pull_request_files_virtualization` |
| `/:owner/:repo/labels/*`, `/:owner/:repo/milestones/*` | various | all with `queryId` |

Repo PR dashboard: `/:owner/:repo/pulls` with `q` (default `is:pr state:open`), `page`, optional
`milestone`. Clean paths, each appending a qualifier to `q`: `/pulls/created_by/:creator`
(`author:`), `/pulls/:login` (`author:`), `/pulls/assigned/:assignee` (`assignee:`),
`/pulls/mentioned/:mentioned` (`mentions:`), `/pulls/involves/:involves` (`involves:`),
`/pulls/review-requested/:v` (`review-requested:`).

`packages/paths/path.ts` (**read**, slice 3) builds several hundred more paths — hovercards,
code scanning, secret scanning, campaigns, org and enterprise settings, stafftools. All GET HTML
fragments or Rails JSON. Consult that file rather than reproducing it here.

### Hovercards

All GET, HTML fragments, driven by `data-hovercard-url` / `data-hovercard-type`. The client appends
`subject=<enclosing subject tag>`, `current_path=<pathname+search>`, and `hovercard_cache` when
`memex_live_update_hovercard` is on.

```
/users/:login/hovercard                      /hovercards?user_id=<id>
/orgs/:org/hovercard                         /orgs/:org/teams/:team/hovercard
/:owner/:repo/issues/:n/hovercard            /:owner/:repo/pull/:n/hovercard
/:owner/:repo/discussions/:n/hovercard       /:owner/:repo/commit/:oid
/:owner/:repo/issues/:n/tracked_in/hovercard /:owner/:repo/issues/:n/tracking/:id/hovercard
/:owner/:repo/security/code-scanning/:n/hovercard
/:owner/:repo/security/dependabot/:n/hovercard
/advisories/:ghsaId/hovercard                /sponsors/:login/hovercard
/copilot/hovercard?bot=<slug>                /automated-reviewer/:reviewer/hovercard
```

Automated reviewer slugs: `github-advanced-security`, `github-code-quality`.

### User and settings

| path | method | body |
| --- | --- | --- |
| `/settings/appearance/color_mode` | PUT | `FormData` `color_mode`, optional `light_theme`, `dark_theme` |
| `/settings/appearance/tab_size` | PUT | `FormData` `tab_size_rendering_preference` |
| `/settings/appearance/viewer-settings` | GET | `{emojiTone, pasteUrlsAsPlainText, useMonospaceFont}` |
| `/settings/blocked_users` | POST | `FormData` `login`, `content_id`, `return_to`, optional `navigation_source`, `note`, `close_content=1`; `redirect: 'manual'` |
| `/settings/blocked_users/:login[?navigation_source=]` | DELETE | — |
| `/organizations/:owner/settings/blocked_users` | POST | `FormData` `duration`, `content_id`, `login`, optional `navigation_source`, `hide_comments=on`, `hidden_reason`, `note`, `send_notification=on`, `close_content=1` |
| `/settings/dismiss-notice/:noticeName` | POST | none. PR notice names: `single_file_mode`, `compact_diff_lines`, `files_changed_opt_out`, `pull_request_modern_header` |
| `/notifications/thread` | POST | `FormData` `repository_id`, `thread_id`, `thread_class`, `id = 'subscribe'\|'unsubscribe'`, `authenticity_token` — one of the few routes that genuinely needs the token; it comes from React context, not the DOM |
| `/notifications/indicator` | GET | `{mode: NotificationIndicatorMode}` |
| `/pulls/preferences` | PUT | `FormData` `default_view`, `max_pr_age`, `compact_mode`, `inbox_options_tip_dismissed`, `collapsed_sections`, `section_order`, `hidden_sections`, `selected_repos`. Lists comma-joined, empty clears. Fire and forget |
| `/_side-panels/user.json` | GET | `credentials: 'include'`, no verified-fetch header |
| `/_global-navigation/payloads.json?type=<PayloadType>` | GET | — |
| `/site/keyboard_shortcuts?contexts=<csv>` | GET | `{commands: Record<string, {service, commands}>}` |
| `/sessions/in_sudo` | GET | `Accept: application/json` |
| `/search/custom_scopes` | GET | `[{name, query}]` |

### Copilot

Same-origin Rails proxy routes (**read**, slices 1–5; the Copilot API itself lives on
`https://api.githubcopilot.com` and is out of scope here):

```
/github-copilot/chat                         /github-copilot/chat/entitlement
/github-copilot/chat/token[?force_refresh=true]   (POST — mints the auth token; 404 = unlicensed)
/github-copilot/chat/repositories/:repoID    /github-copilot/chat/repositories_search
/github-copilot/chat/custom_copilots[…]      /github-copilot/chat/file_contents[…]
/github-copilot/chat/implicit-context/:owner/:repo/:encodedUrl
/github-copilot/chat/feedback                /github-copilot/feedback
/github-copilot/preferences                  (PUT, FormData)
/copilot/chat/autocomplete/{issues,pulls,discussions}?repo=<nwo>&q=<filter>
/copilot/chat/reference/:owner/:repo/:type/:number    (type = pull_request|issue|discussion)
/copilot/chat-links?item_url=<url>           /copilot/personal_instructions
/copilot/agent-sessions/pull-requests?pull_request_ids=<csv>[&include_body=true]
/copilot/agent-sessions/pull-requests/:pullId/agent-mentions
/copilot/agent-sessions/quota-snapshot       /copilot/agent-sessions/alive-channels
/copilot/agent-sessions/users?user_ids=<csv> /copilot/agent-sessions/filterable-agents
/copilot/agent-sessions/:nwo/agents          /copilot/agent-sessions/agents/:agentId
/copilot/tasks/:taskID                       /copilot_issues/bulk_create
/:owner/:repo/pull/:n/copilot_diff_chat/?base_oid=&head_oid=
/:baseOwner/:baseRepo/copilot/coding_agent/models?pull_id=<pullDatabaseId>
```

The model-picker URL is built on the **base** repository, not the head repo, for fork PRs.

`/:owner/:repo/agent-sessions` (POST) creates a fix-workflow agent session. Body is `FormData`,
snake_case: `problem_statement`, `base_ref`, `event_type`, `event_content`, optional `event_url`,
and when a check run is given **both** `check_run_id` and `workflow_run_id`. The source carries the
comment *"note: hyphen, not underscore"*.

### Legacy Rails surfaces on the same page

Server-rendered forms submitted through `@github-ui/remote-form`, which carries the Rails
`authenticity_token` from the form's own hidden field. The action is not in any bundle.

| selector | notes |
| --- | --- |
| `form.js-toggle-user-reviewed-file-form` | the "viewed" checkbox; response is an HTML fragment |
| `form.js-inline-comment-form` | fields `in_reply_to` / `comment_id`, `path`, `start_side`, `start_line`, `side`, `line`, `start_commit_oid`, `end_commit_oid`, `base_commit_oid` |
| `form.js-single-suggested-change-form`, `form.js-batched-suggested-changes-form` | inputs rewritten into `changes[][commentId\|path\|suggestion]` |
| `form.js-remove-from-queue-form` | merge-queue removal |
| `.js-comment-update`, `.js-comment-delete`, `.js-issue-update`, `.js-comment-minimize`, `.js-comment-unminimize` | all add `X-Body-Version: <comment[data-body-version]>` |
| `.js-issue-sidebar-form` | `Scoped-CSRF-Token` header from `.js-data-url-csrf`, `mode: 'same-origin'`; response is HTML |

`Scoped-CSRF-Token` is the third CSRF scheme on this page, alongside `GitHub-Verified-Fetch` and the
plain Rails `authenticity_token`.

Supporting elements:

- `<include-fragment src=…>` — GET with `Accept: text/html` and `credentials: 'same-origin'`.
  GitHub patches `.fetch` to add `addBaseFetchHeaders(request.headers, this.getAttribute('data-nonce'))`.
- `<auto-check>` — `http-method` attribute picks GET or POST, default POST. POST sends `FormData`
  `{<csrfField>: <csrf>, value: <input.value>}`; GET sends `?value=`.
- `<toggle-switch>` — POST `FormData` `{<csrfField>: <csrf>, value: '1'|'0'}` with **both**
  `Requested-With` and `X-Requested-With` set to `XMLHttpRequest`.
- `updatable-content` — GETs the element's poll URL and swaps in the response text.
- Batch deferred content — POST to `[data-url]` with `FormData`
  `items[item-N][<input name>]=<value>` plus `_method=GET`; response `{"item-N": "<html>"}`.
  Queue flushes at 30 items or 50 ms.

### HTML fragment safety

**read** — `packages/html-safe-nonce/html-safe-nonce.ts` and `packages/fetch-utils/fetch-utils.ts`
(slices 1, 3, 5 — three-way agreement).

`fetchSafeDocumentFragment(document, url, options)` accepts a response only if `Content-Type` starts
with `text/html` (or `application/json` when `allowJson`) **and** the `x-html-safe` response header
matches one of the document's `<meta name="html-safe-nonce">` values. There may be several.

Helpers in the same file:

- `fetchPoll(url, options, timeBetweenRequests = 1000, acceptedStatusCodes = [200], pollStatusCodes = [202])`
  — 202 means keep polling, ×1.5 backoff, `options.onPoll(responseClone)` per poll.
- `fetchRetry(url, fetchOptions, {wait = 500, acceptedStatusCodes = [200], max = 3})` — linear
  backoff `wait * attempt`.

---

## `/_graphql` and persisted queries

### Transport

**read** — `packages/fetch-graphql/fetch-graphql.ts` (slice 2, full source), corroborated by
`packages/datadog-rum/datadog-rum.ts` in slices 1, 3 and 4.

| field | value |
| --- | --- |
| path | `/_graphql`. A `baseUrl` override is rejected unless it ends with `/_graphql` |
| method | **GET for queries, POST for mutations** — chosen in `packages/relay-environment/relay-environment.ts` from `params.operationKind` |
| GET | `?body=<encodeURIComponent(canonicalPayload)>` |
| POST | the canonical payload as the raw body, through `verifiedFetch` with `skipTraceReporting: true` |
| canonical payload | `JSON.stringify(stableCopy({persistedQueryName, query, variables, scopeObject?}))` — keys alphabetised by `stableCopy` so the string matches an early-hinted or preloaded request byte for byte |
| `query` | the persisted query **id**, not GraphQL text |
| `persistedQueryName` | the GraphQL operation name |
| extra params | `subscription=1`, `scope=`, `subscriptionTopic=`, `dispatchTime=`, and `_features=` forwarded from the page URL |
| headers | base fetch headers + `Accept: application/json`; `X-GITHUB-PREHEAT: <source>` when preheating |
| GET opts | `cache: 'no-cache'`, `credentials: 'include'` |
| response headers read | `X-Subscription-ID`, `X-Github-Request-Id`, `Server-Timing`, `Retry-After`, `X-RateLimit-Reset`, `X-Reject-Reason` |
| errors | status > 401 and != 404 throws. **A 404 on a POST means signed out** and triggers `location.reload()` |

Validation patterns from the RUM reporter: the id matches `/^[A-Za-z0-9._-]+$/` and the operation
name `/^[_A-Za-z][_0-9A-Za-z]*$/`, both capped at 256 characters.

### Two hash families

There are two persisted-query mechanisms and they use different hashes. Do not mix them.

| mechanism | id format | where it goes | source |
| --- | --- | --- | --- |
| Relay persisted queries | **32 hex** (md5-shaped), from `params.id` in `__generated__/*.graphql.ts` | the `query` field of a `/_graphql` payload | slices 4, 5 |
| Server-persisted queries | **64 hex** (sha256), from `packages/server-persisted-queries/server-persisted-queries.ts` | a `queryId=` **query parameter** on an ordinary Rails route (`/_ghui/…`, `*.json`), or occasionally a `queryId` key in the JSON body | slices 2, 3 |

**Unresolved.** Slice 2 states the 64-hex table is for `queryId=` params "not `/_graphql`". Slice 3
states the same table holds "the values a `queryId` param **or** a `/_graphql` `query` field takes".
Slice 3 also describes the `/_graphql` `query` field as a "64-hex persisted query id", while slices
1 and 4 read only the looser `[A-Za-z0-9._-]+` pattern. The published third-party hashes (see the
next section) are all 32 hex and are sent to `/_graphql`, which supports slice 2's reading. Treat
64-hex-to-`/_graphql` as unverified.

### Relay persisted query ids (32 hex)

**read** from `__generated__/*.graphql.ts` `params.id` (slices 4 and 5).

| operation | kind | id | variables |
| --- | --- | --- | --- |
| `setLabelsForLabelableRelayMutation` | mutation | `37bdcd14b346f3e7d835485eaabbd766` | `{input: SetLabelsForLabelableInput}` |
| `updateIssueProjectsRelayMutation` | mutation | `b695a1b44dfc6808873f990340430ce1` | `{connections, input: AddProjectV2ItemByIdInput}` |
| `updateIssueMutationContentOnlyMutation` | mutation | `d1d9840a47a7be6dd0ad285ce57f1c7f` | `{input: UpdateIssueInput}` |
| `updateIssueMutationDeleteProjectMutation` | mutation | `ad9e6eaf34525daacc17362653e63272` | `{input: DeleteProjectV2ItemInput}` |
| `useIssueQueryQuery` | query | `74cdd586b6f12a28054626de37364e0a` | `{owner, name, number}` |
| `useLabelsQueryQuery` | query | `b83819e3267088a514ba0c0458c33d5e` | `{owner, repo, count?, labelNames?}` |
| `TemplatePickerQuery` | query | `453f03781d915408c3c338e5d346e0be` | `{owner, repo}` |
| `useRepositoryDefaultBranchQuery` | query | `cc890d4a355bf52f7d7b18263e22f595` | `{owner, name}` |
| `IssueViewerViewQuery` | query | `39d9663ba0233a929ed631420222f710` | `{owner, repo, number, allowedOwner?, count?, hideTimeline?, skip?}` |
| `IssueViewerSubscriptionMetadataSubscription` | subscription | `fef2f177f4af85de38bff3d0f8e05cf5` | `{issueId}` |
| `IssueViewerSubscriptionTimelineSubscription` | subscription | `8655ab813318c5c0e27e44e4131f4547` | `{connections, issueId, skip?}` |
| `ParentIssueSubscription` | subscription | `f62dedb1d4ba1d25145345d96389fd7c` | `{issueId}` |
| `useRecentAgentActivitySubscription` | subscription | `68fdf94adf68d1dedcc75fcea6c9489e` | `{issueId}` |
| `useTimelineItemsBackQuery` | query | `7ba8c2219fca8a27b55351615f831ea9` | `{id, count, cursor?}` |
| `NewTimelinePaginationBackQuery` | query | `6bf8866bd1f26e86ecd4d4ec1877c998` | `{id, count?, cursor?}` |
| `NewTimelinePaginationFrontQuery` | query | `356bb9b6c9c268f9e67db2d76eb82b65` | `{id, count?, cursor?, skip?}` |
| `NewTimelinePaginationHighlightQuery` | query | `497186160be9f4eefcebad57ad51c35b` | `{id, after?, before?, first?, last?, focusText?, focusNeighborCount?}` |
| `useTimelineHighlightQuery` | query | `49499a80d4aa19a70a9f5aa4955c30ea` | `{id, first, focusText, after?, before?, last?, focusNeighborCount?}` |
| `LazyRelationshipsRelatesToListViewQuery` | query | `eeadb164c4b07003ff4e3cb46ab22c66` | `{id, cursor?, pageSize?}` |
| `LazyRelationshipsRelatesToListViewPaginatedQuery` | query | `0efc123ba8dc309e417fd9781c772fb1` | `{id, cursor?, pageSize?}` |
| `secondaryTimelineQuery` | query | `d67f355afda62b7439d3be50ff7fcdfc` | `{nodes: string[]}` |
| `deleteUserContentEditMutation` | mutation | `71452b9f40a7828ac05811d1ad4f821e` | `{input: DeleteUserContentEditInput}` |

No Relay artifact in any slice references a pull request operation. The PR page uses `page_data`, not
Relay.

### Server-persisted query ids (64 hex)

**read** — `packages/server-persisted-queries/server-persisted-queries.ts`, header
*"auto-generated by scripts/sync.ts"*. Slices 2 and 3 each dumped the whole table; the two dumps are
byte-identical, 113 entries. Confirmed by 2 slices.

```
addCommentMutation                        5bb7ced3fd797c84586d2aa93180f45627877c19f8c61c97196e3a780d81aac7
addReactionMutation                       efc7bb40ff5fc25167ffce1f560ad0b4aaa6033f3ee50ff08b2b7665732abd6b
addSubIssueMutation                       17a25343b4b3fe2dfb3e31b74aac7c3edbcf44d2e22e934315807fcd5c759637
applyPendingIssueSuggestionsMutation      0f1bca30352d19e48a393a96f151fa50bee1263bbbac82aade05c2ca8fe02de3
BranchPickerSharedSearchBranchesServerQuery f1152f2c02a6c75cd57d8613498cf6ce5c1a7601464473291d5cd57803bc8d09
clearProjectItemFieldValueMutation        4f1bc8fd123af97b6bfe8dfd3964545e5d5ae9c26964b7954f5d4604ed12973a
ClosedByPullRequestsReferencesServerQuery a0f24130e95bcd2841cae56e7990dcf67ee40f831f01eca441a31d1cb2cf04a8
CommentEditHistory                        63d567f03d410dfd1c29577248f06761f9f1c60d7130c4c8f3c005c39244df28
convertIssueToDiscussionMutation          6663292783c214335a3b71050a82b398b7a9d0c78b6a9fea4045483d896b0d23
ConvertToDiscussionDialogServerQuery      6a1620031ee4b71e99be33b0d71a52735125542a2bfafebd34270ad38f3e0863
CreateBranchDialogFindRepoBranchesServerQuery b9653b7adf6bf46915999c45d4c83c9c3e8e94b7fe23525b524939690c79d183
CreateBranchDialogReposServerQuery        34a1513faec9d984c8113c401ddbb1b3ee4d1c3ad61df7a9cc336a1f8384fcf8
createIssueAddBlockedByMutation           62bc188e483df624c90a1dd878efd1f230d470b14ef469a8ece6f53ef2735cd1
CreateIssueDialogEntryQuery               d90002967bc4896dda9fe0d4b7273feb68c8412632391a1d069b9a40543cc5e1
createIssueFieldValueMutation             1aa77806d8df022c8b8239fc2067aedce71390ad96b645dad5c3e2174325ec3e
createIssueFromChecklistItemMutation      c19b092bb8b870a47ba6a9547d6960be9c48bc53eb6c8de536120dc0ef738c8b
createIssueMutation                       9984268af44fccd4682d16c1a271784414c8aeaeec87562fe026599bc7ceecc6
CreateIssueQuery                          8096769d421259479b4bed98f7485592f2ab0fb974b91174a895fbfb91e14316
CreateLabel                               671157d2a96fabc292d3c7918c01b06ddba14372ed1c2cb05b7450ada89d1f0f
createLinkedBranchMutation                eabd2b56e346fd15ccc6033ac89f80200a204481c4ea6097fc4d3d016f9ccc8c
CreateMilestone                           5304186ccb6032d17eadfb9b9429b87c2b6a94326452233a9d1a8dc5881086fd
createRepositoryLabelMutation             6413fe0f5295c6e029365bb6d39610f32044e096bc05cf5482db2af6786404e1
createRepositoryMilestoneMutation         9d96645e8eda5380de785c16f31220321dc7cc8f2d9f04ee6a4a7f1741ae849e
createSubIssueFromChecklistItemMutation   d1f63ff927a58e4e775ede521a2891cc963b72728794e936a2c8bacb8fd8bd62
deleteIssueCommentMutation                1eb0aaf76e0e3f1c0ab0d61eb39452f7c83634de93bd83cbd7d8445123330c5d
deleteIssueFieldValueMutation             0dbb076c3866b2e6457f09d9ec69a6feacb1c73a82300edbac71d988b121bbae
deleteIssueMutation                       cf602c15c4eecf803cd4c7899bc3d7741c008b207714f9cb815bba331dac9e66
deleteIssueProjectsMutation               fef12c808f5b534fdefc04386f72a1c820144f8721ae03bc1875a6c497ae7e21
deleteLabelMutation                       7da1c95f9e2549187b35f078c8c1c11365bc3f057d7d07643c44f064755b3421
deleteMilestoneMutation                   3843189533e0591b3813a92d887d77291b955638c3e1ca6b0555aa5ccbe6bf79
DependenciesPickerRelationshipsServerQuery 3f06051aa475caefdeecd2b51426ea84baf4e451bef4ddd1e567a3b860034d40
DevelopmentPickerServerQuery              4a4bdeabda0af965a15769d2b386503eb2a5cc0783bafb3af4afd4d8e443a04d
EditHistoryDialogQuery                    54484dd53957e713c620274fc02d644389f7b0d127b75ec83cdec23e55b98fa5
FilterSuggestionsProjectIssueTypes        6c003eb9c717c35594d6de8e0de6d1ac011d02db92aa76b5be6ecf1e321e67e8
FilterSuggestionsRepoIssueTypes           f386f7ab6d1d318570556fc9c4a6a4db2bf5cb20e8d0eb8afbdf27503abaff2b
FilterSuggestionsViewerIssueTypes         7e62fd7aa66e44a7f0411658ca80bb54b557f35de858ac06c1be65dcbebfc832
InternalIssueNewPageUrlArgumentsMetadataQuery ae0fe744f397e2b2121e605d909268b00d93e86f5d94b2db560fdb6fcdd5757f
IssueBodyRefetchServerQuery               68669c77eeef558f9981f21c84763d376845f4f9793f266776f8281d7740077a
IssueCommentViewerRefetchServerQuery      49a7682f9ccab868081ed13db826d86eb3bf97c38af4627950e47f9dd4f562fc
IssueFieldPickerServerQuery               4691509829df7dbacee63c69ea51197641944d632536b1ee463e7a6e5e8aaa8a
IssueHeaderRefetchServerQuery             a2d1d0db093e7be3ad502d73953d54f2eb90fb252840b0c70be72e6a579e1ae5
IssueMultiSelectFieldPickerFieldServerQuery 2d38aca734364600057f8856cb6e2f61c8da0320936c0d02c315d1d5a038d483
IssueParticipants                         23512f5f655f80c12a565b783ff11a36fa84c34c7349bf04c08f2df041c64e01
IssuePickerFilteringServerQuery           31f3b71110d5043460fadf146fe9b5f03c374f08bee143112cd452da119cc521
IssuePickerSelectedIssuesServerQuery      aefeedc73ed8f7e613529ee6dc2076f86412eea2a06faaa91aa85aef5409ba74
IssueRelationships                        b1cd7ed2e279470e0f076906ba9c8df465aa6c09f21cdf04fe70c3489a9ed7ae
IssueRelationshipsBlockedBy               029e209df4a7fa64d2da8b5924bfa7f9e42cb472c38d44e16af83d99cc0d0d02
IssueRelationshipsBlocking                7743eb6ead819828d99d006eaf53cc08ec0b7371c7ddf50dd62b78b8878bc020
IssueRepoNewChoosePageQuery               e243ff362078d5485cb2fcd0602e2baa8af4a54e08ef7e60f5649826c5edf050
IssuesGhostUser                           f00cbb92da929ef65f40a8ee9dbd53974815592b09222cb33595bb249c7a4d5d
IssueSingleSelectFieldPickerFieldServerQuery 124190bf2c6de9dbd4bcbf28f3776107418764941518ee27e2c4adb0fda25f15
IssuesSafeViewer                          f998eeeac56ca774f256b128fca77ca6b4fbf670d9a02c17ca35f57b56ee2d7a
IssueSubscriptionStatus                   3b726b00a49858cc65756b61c97611b877b32ca7bf0c8290d96700fa98dbd129
IssueTimelineItems                        ecddfcf6cdb75d7d7a4a4f09117164d49cf7644f1925c4ee9b2e62966decf3c9
IssueUnmarkAsDuplicate                    be776848bbe9388fbfa050250b5da4ffeebf39b2ba2f02e535d62b46e3be9478
IssueViewerPage                           012b2aea85b08bdd8bd822f4742cdc84b4e86fba917a72b3a9cc0a7eb6cadcf8
IssueViewerSecondaryViewServerQuery       7ea3407c370e75a3b772fcff2e852056611d178aa2647983b4dd3548f86abcc2
LabelCountsQuery                          579a5c2a5f32de1f9c7d30a320829696aac1ce88c8be86a56178a9a9bf551520
linkPullRequestsMutation                  164b7fa64dd712db128f950951c4b5a84a69fca46b43d0cf06aa720fcdb0bbeb
MarkdownEditHistoryMetadataServerQuery    481871004695ead9d12b7b4becfe58d00e486d509a6b06a329d8f6ed9484fa91
minimizeCommentMutation                   6849ed52b151ea786dca85906c31b4152904cbd85684b4c979a33fb2c9f92654
pinIssueMutation                          ec93135ee0978e1ad7c6341bf7a5a96e9dd8f50650439df82a5c130b757f519c
prioritizePinnedIssuesMutation            e16488d1bfb19f0ac8966b2f8dc8ccba5d0d2b5854e8b31602a713493a5f8d9d
ProjectItemSectionFieldListServerQuery    d64f7844963dd2571518864165a455e4acbbc414bddf5202aac1f86f6056eb43
PullRequestAndBranchPickerSearchServerQuery be5456f2196b6b586d76cb2010939f7499ef9f4eb00955f9adba5eba6cefedb2
ReactionViewerRelayServerQuery            724d58566f478e662cfdcb0ecd205ba9fe9fc7756be2473cada56020417e94c1
rejectPendingIssueSuggestionsMutation     fcb0e441c7e390de5e36d8548d4a82884c5616b2bb5db634e4a6dd2aeaa33f1b
removeReactionMutation                    c1280c90d76e9a74a67bd940d6ace69c980c2f7d2362a275539e030d1e7747f8
removeSubIssueMutation                    f6b5a75459a75a7883cfd1eebb8f65e25a5d3a0b59c81f8d54c0a76a48c7bc9d
replaceActorsForAssignableRelayMutation   1ed183ddb616e9b3c7bc22b4054248239108485873c54a545ce62a643e713684
RepositoryLabelIndexPageQuery             88cda353fb6a87526fb2043db610637665ac66cc52d99abf1d6453ea1577f622
RepositoryMilestoneEditPageQuery          e0476525686bd8dc2b346af1b2012ef3a382fe9ff52a44eb77d3723e4d7c204f
RepositoryMilestoneIndexPageQuery         bbeefbf29f941c1e15044c2d6fd60a6f9cc60065754c96d2696a807816ba0284
RepositoryMilestoneNewPageQuery           74ac00c6b58bdd6cf84a1ecc715d7a2a50331edec3179b4368df5c7f462e56fd
RepositoryPickerCurrentRepoServerQuery    85c08cc16e99e98cda0028d8f01610f92a9a7003f4e808a615073e06080bbdea
RepositoryPickerPossibleTransferRepositoriesServerQuery 640d93c86bee72f22a904a1cb5b578ab15c17b3a2f6c974b322eac17fd5d2d97
RepositoryPickerSearchRepositoriesServerQuery 735aa4b35f4c5f16fe81ad773f4803b7fbc9be3c2573fd31f86118d09db2c186
RepositoryPickerTopRepositoriesServerQuery 946af109402892f60faf11ee03805d08e9f2390a712cca70157c2a6224b61df6
reprioritizeSubIssueMutation              ba5fde74920619d1b569f46e2778c97aaf46a8693487656cd649aba7e7ab77f6
SearchAssigneesInIssue                    08ef463eca0c379a3aa55a3d1111f6564c782bc289ea77c682b1cae68724d900
SearchAssigneesInRepo                     ab0a3fd3d2d0ad2a361566f2aec59c9d357d7a1616e6c9577b0496caf4cc9154
SearchIssueTypes                          d959970a3cee580ad4f27a84bc411cece6b17ff1ce0cfc57a941f1e55c33efb9
SearchLabels                              6c82cd3dc62703e6b5645c27ce20ca998e2e2d08ba17bfb54fac2b7d6ea0b0df
SearchMilestones                          8bfb8d5dced8d160c5e46d13ac616c638571481da2843bbd2e4d11f6d0333003
SearchProjects                            ff2e38dd2d865df16410043f55ea309d4df4a177788ba8783ef8f88c57916095
SecondaryTimelineServerQuery              320250747dd46c65693d349c982841c14d7ebafd1bd99b762fa37258cbedb5aa
setParentMutation                         77a5e7acf7fdcd718f627c0ef818ba917b2489536ccff305ab3ae5499abf5a44
SubIssuesListItemNestedSubIssuesServerQuery f306bd6630b4da7b7a1b13abe413150446c0d754bf33cff628d12685860095fb
submitAbuseReportMutation                 97f897b2697c8d261823e6f976d7316c9f13092ee606c0f6fa1f47b876161b1f
TemplateListPaneQuery                     187476022829ae3bda4c0720ba8a23ed0d7480e9e0a64440098f3d7d2725dd24
transferIssueMutation                     22b80ae82399021420b34b28b6d01f6ea51596a3fc6eaf10e798f1d31664f631
unarchiveProjectItemMutation              72477e7520b023ab60a1f8d52625e6556b50695cdc195a58462eccfd97e7cda8
unblockUserFromOrganizationMutation       c539d0314a3090e2ba7cbd400e5bdb5cddbf2a5d8e3250af54c6b21133b760bd
unminimizeCommentMutation                 536af4d71c481157bde906a4c6a582828da570d5a4f25dbb12fc3ab455ff0d31
unpinIssueMutation                        8c808586d874ef7a07396c12735fc77726ee14a996b355dfbc4b5ea11ab32eab
updateIssueBodyMutation                   b411bace27cdbc90397fc8a7d2ee07d421fc94f234bb2650d28cf10a28f53523
updateIssueCommentBodyMutation            3b25e93e66fdd760ce3d4e941d5be24ef170ef5831b4faefd363711d8e1b577a
updateIssueFieldValueMutation             d19b0f9dc13e53a1128433b45db64743b9ae9092c3ea6efdf6aa4acbd8aca8fa
updateIssueIssueTypeSharedMutation        45c5e217f496042bcc7fb224593eaad4d8d5d459fc085631c7fef2ff75344969
updateIssueMilestoneRelayMutation         c036189bf353f7c11d57459e316da049cc252207b5e6438ae1e0d63be1fc11e0
updateIssueProjectsMutation               59cd9b896117b03260988f2f8b0a88f7174ad79a22783c941369e98548248511
UpdateIssuesBulk                          1f34df088e4c830c4f4a617470e6bf2b7dbc12efdbda52dab361fd7e84dd1bee
UpdateIssuesBulkByQuery                   9b91b5ad1822552b4e227c1f6220b59b4e588ac00a11b1167d829b384ab675d5
updateIssueStateMutation                  46142e6adef17648c3a060d0c11727996c3c7f06d709b4a768ca1a264104fcec
updateIssueStateMutationCloseMutation     b4d5c561249ba43158da930f496cfdc02c3fa01e0121b4494344678a5ac04c72
updateIssueSubscriptionMutation           f903f48b634b4667bdf38a46fac2ab4c3077f07c9e9b7cf0245c015372abddcb
updateLabelMutation                       8ddf031289a2bb1ba7a3d8c1a9a7a4ffb547d00b8cefbf2fa39d02627e168788
updateLabelsForLabelableRelayMutation     391777cd37a8fca8a49882d6981f5030b377e76042ff33369199d57144b61939
updateMilestoneDetailsMutation            0235b45c5ab32d6df8920eff8166e2dcb21fe0505da39cd73f69616778b4d77c
updateMilestoneMutation                   64a067360cffbac28cb5ab67e3003b3cbe85211c7698b110885006ab4dd343b2
updateProjectItemFieldValueMutation       c680677038356949613fa3c124c144067672c100f2f94a3875980d20e4ffece7
UseCopilotAgentDefaultBranchRepositoryServerQuery a8e0d85b440d98db6a18ef6476d4a66e2701b1860b664adb1cec2cb5b2ddc527
useIssueFormSecondaryQuery                3a46847bc1b0cb2ef858a11ab6c696db0953c8d561564cb87f53a59ced1c15af
```

---

## What is documented nowhere else

A dedicated search of grep.app (roughly a million public repositories), DuckDuckGo, Bing,
docs.github.com, the GitHub changelog and engineering blog, GitHub Community Discussions and Stack
Overflow found **no documentation of the `page_data/*` family — official, semi-official or
community.**

### The one project that documents one endpoint

`tools/gh-review.py` in `tarantool/tarantool`, with `doc/agents/review-gh.md` alongside it. First
committed 2026-09-01. A CLI for agents that post a per-commit PR review: the public REST API cannot
anchor a review comment to an individual commit's diff, so an opt-in `--experimental` mode posts
through the web UI's own endpoint, which it calls "the private API of the GitHub web UI".

It covers one route in full — `POST /:owner/:repo/pull/:n/page_data/create_review_comment` — with
method, URL, headers and the complete body including `positioning` for single-line and multiline
comments. Its own provenance note: *"The format of the request is deducted from a real one scrapped
from a browser."* It reads a non-JSON response as an expired session cookie.

Its most useful operational finding, and one we should keep in mind: the endpoint attaches the
comment to the **cookie account's** pending review. A mismatch between the cookie and a REST token
used elsewhere splits the review in two, silently. Nothing in the request names the account, which
is why they force the caller to pass `GH_COOKIE` as `<login>:<cookie>`.

### Everything else that is published

| endpoint | who |
| --- | --- |
| `GET /_graphql?body={"query":"<md5>","variables":{…}}` | refined-github, gkd-kit/inspect, gkd-kit/gkd |
| `POST /_graphql` with the same body shape | same three |
| `POST /upload/policies/assets` → `POST <storage upload_url>` → `PUT <asset_upload_url>` | lisonge/user-attachments, gkd-kit/gkd, j178/github-s3, maple3142/ghfileupl, drogers0/gh-image |
| `GET /github-copilot/chat/token` | rohitaryal/copilot-RE, xtekky/gpt4free, steipete/CodexBar |

Published persisted-query hashes, all 32 hex:

```
IssueViewerSecondaryViewQuery      cb9b35846fadf5f80ec3a2c05bf42a89
updateIssueSubscriptionMutation    d0752b2e49295017f67c84f21bfe41a3
addCommentMutation                 edafa18ab5734f05c9893cbc92d0dfb1
deleteIssueCommentMutation         b0f125991160e607a64d9407db9c01b3
```

Note that the last three carry operation names that also appear in our 64-hex server-persisted
table with completely different values. Same name, two ids, two mechanisms — see
[Two hash families](#two-hash-families).

Published headers for cookie-authenticated internal calls: `github-verified-fetch: true`,
`x-requested-with: XMLHttpRequest`, `accept: application/json`, `origin: https://github.com`,
`referer: <the page>`, and `x-github-client-version` (Refined GitHub sets it to identify itself).
Nobody explains what `github-verified-fetch` is; 23 repositories on grep.app send it. The
explanation in [How the routes are built](#how-the-routes-are-built) is read from GitHub's own
source and appears in no public write-up.

### Documented by nobody, including these

```
GET    /:owner/:repo/pull/:n/page_data/threads
GET    /:owner/:repo/pull/:n/page_data/thread_previews
GET    /:owner/:repo/pull/:n/page_data/file_tree
GET    /:owner/:repo/pull/:n/page_data/base_comparison_info
POST   /:owner/:repo/pull/:n/page_data/resolve_thread
POST   /:owner/:repo/pull/:n/page_data/unresolve_thread
PUT    /:owner/:repo/pull/:n/page_data/submit_review
POST   /:owner/:repo/pull/:n/file_review
```

Nobody has published the sourcemap exercise against github.com either. The general technique is
well covered (`rarecoil/unwebpack-sourcemap`, `paazmaya/shuji`, `davidkevork/reverse-sourcemap`,
and write-ups recovering whole API surfaces from maps), but not applied to this target.

### GitHub's position

There is none, specifically. The nearest policy text is generic: the Terms of Service API section
bans abuse and excessively frequent requests; the Acceptable Use Policies define scraping as
automated extraction and attach an anti-spam restriction to it, and section 4 bans "excessive
automated bulk activity". Nothing addresses undocumented endpoints.

Read together: nothing prohibits a signed-in user's browser extension from calling the same
endpoints the page itself calls, at page-usage rates. Equally, nothing promises they keep working.
No stability guarantee, no deprecation policy, no published rate limit, no versioning.

The one on-record GitHub remark touching third-party tooling on this page is a known limitation in
the 2026-01-22 changelog "Improved pull request 'Files changed' page on by default": for large PRs
the virtualized mode breaks "Using browser extensions that need all diff content on the page." That
is about the DOM, not the endpoints, but it is GitHub saying extensions on this page are on their own.

---

## Stability and risk

**The routes are not the brittle part. The payload shapes and the feature semantics are.**

Evidence, from the sixth pass:

- **Refined GitHub runs a remote kill switch.** A separate repository, `refined-github/yolo`, holds
  one file — `broken-features.csv` — that the extension fetches at runtime to disable features
  GitHub has broken, with a "minimum working version" column. Its commit log is a usable churn rate:
  15 disable/restore events in the ~10 weeks to 2026-09-11, roughly one every five days across
  ~100 features.
- **Their one internal-endpoint feature lasted seven months.** `status-subscription` used
  `/_graphql`; merged 2026-01-10, hot-disabled 2026-08-11, restored 2026-08-14. The cause was not a
  moved route — GitHub removed custom thread subscriptions outright. It also needed three
  correctness fixes inside those seven months for behaviour changes on GitHub's side. The failure
  mode that matters is the **feature** disappearing, not the route being renamed.
- **A one-word route change cost another extension eight months.** Codecov's browser extension,
  issue #154, opened 2026-01-06 and still open 2026-09-06. The new PR experience moved the URL from
  `/files` to `/changes`; the extension's URL regex stopped matching and it silently did nothing. A
  maintainer replied the same day, then went quiet for eight months.
- **This whole surface is the product of an in-flight rewrite.** The old PR page served HTML
  fragments; the React page serves JSON. Public preview 2025-06-26, updates 2025-07-31, 2025-09-11,
  2025-11-20, default on 2026-01-22, more changes 2026-02-05. Several shipped changes per quarter to
  exactly the page we depend on.

What follows for us:

1. Carry a runtime kill switch, the Refined GitHub way.
2. Treat a non-JSON response as "session expired or route gone", the tarantool way. A 422 with an
   HTML body is what a missing route returns (**measured**).
3. Validate payload shapes at the boundary; expect fields to appear and move. `thread_previews`
   already returns either of two shapes and the client sniffs which.
4. Revalidate whenever GitHub ships another "Files changed" changelog entry.
5. Keep the cookie identity and any token identity the same account, or reviews split in two.

---

## Gaps

What the six passes could not resolve, so a later pass knows where to look.

### Unresolved contradictions

| what | the disagreement |
| --- | --- |
| `X-Fetch-Nonce` direction | request header (slice 2, `fetch-nonce.ts`) vs response header only (slice 5, `turbo/events.ts`). Both literal reads |
| `add_comment_reaction` body | `{reaction, commentId: number}` (slice 2) vs `{reaction, issueCommentId: string}` (slice 4). Two call sites, one route |
| `update_review_comment` response | wide type in source (slice 2) vs single `bodyVersion` field on the wire (**measured**) |
| 64-hex ids and `/_graphql` | slice 2 says `queryId=` params only; slice 3 says `queryId=` **or** the `/_graphql` `query` field |
| `re_request_review_from_user` body | `{reviewerId}\|{reviewerLogin}` + `review_effort_level` (slice 4) vs `{reviewerLogin}` alone (slice 5). Probably two call sites, not a conflict |
| `deleteReviewComment` | live mutation hook builds the path by hand (slice 2) while the registry entry is commented out (slice 5) and the route answers 204 (**measured**) |

### Modules in no slice

The six passes covered 321 bundles; these modules were in none of them, or their maps were missing.
Each is worth a targeted hunt.

- `@github-ui/paths` — was **read** in slice 3 as `packages/paths/path.ts`, but only as a path
  builder. Methods and bodies for most helpers are still unknown:
  `pullRequestDismissAutomatedReviewCommentPath`, `pullRequestReopenAutomatedReviewCommentPath`,
  `pullRequestFeedbackAutomatedReviewCommentPath`, `orgBlockedUsersPath`,
  `codeScanningAlertTrackingLinksPath`, `codespacesPath`, `bulkUrl`.
- `@github-ui/api-insights-tracing` `getInsightsUrl` — wraps **every** `page_data` URL. The param it
  adds is unknown. We omit it and nothing breaks (**measured**), but it may carry tracing the server
  expects one day.
- `@github-ui/item-picker-base/api/urls` — `buildItemPickerSearchUrl`, `buildItemPickersUrl`.
- `packages/mergebox/page-data/payloads/merge-box.ts` — the `merge_box` response type. Imported
  everywhere in mergebox, absent from every map in every slice. Only re-exported names are visible:
  `StackEntryPayload {pull: {number, headOid, state, url}, status}`,
  `PullRequestMergeRequirementsPayload`, `ProofOfPresenceMetadataPayload`, `RepositoryRuleType`,
  `RuleRollupResult`.
- `routes/files-changed-routes#fileMetadataPath` — the `file_metadata` path shape comes from a proto
  doc comment, not a read of the builder.
- `@github-ui/generate-commit-message` — the "Apply suggestion" commit-message generator;
  `requestGeneratedCommitMessage({diffHunks, basePath, ssoOrgIds, signal})` against a
  backend-supplied CAPI base path.
- `fetchCAPI` — the Copilot API base URL and auth header. Out of scope for this document.
- `COPILOT_ASSIGNMENT_API_ENDPOINT` — the suffix after `/:owner/:repo`.
- `COMMENTS_VIEW_MODE_SEARCH_PARAM` — the literal query-param name that toggles the PR comments view
  mode. Read as a constant name only.
- `CommentsPreference` enum values (`Visible` / `Collapsed` → wire strings) for `/users/diffview`.
- `AsyncFilterProvider` — the `/_filter/*` request builder, so the query params for every filter
  suggestion route are unknown.
- Command palette `Query.params()` key set.

### Routes named but never called in any slice

- `page_data/agent_merge`, `agent_merge_session`, `pending_review`, `merge_instructions`,
  `findings`, `change_base`, `dismiss_review`, `update_title` — in the registry, no call site read.
- `code_review_findings/feedback` — path built, submitting component elsewhere.
- Methods for `page_data/update_file_tree_width_preference` and
  `update_docked_panel_width_preference` are read at call sites in slices 1 and 4 but not in the
  registry, so their status is odd; recheck.

### Rails form actions that are in no bundle

The action for `form.js-toggle-user-reviewed-file-form` (the "viewed" checkbox), the issue and PR
triage bulk-edit form, and `.js-issue-sidebar-form` are all server-rendered into the HTML and never
appear in JavaScript. Read them off a live page, not a bundle.

### Bundles with no sourcemap

16 of 321 across the six slices, every one a vendor re-export stub (react, react-dom, scheduler,
react-is, react-reconciler, react-compiler-runtime) or a route-component shim with no code of its
own. No GitHub code was lost to a missing map.
