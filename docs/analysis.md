# How diffshub.com works today

Read from `research/pierre/apps/diffshub` (the site's own source) and
`research/pierre/packages/diffs` (the viewer). File references below are
relative to `research/pierre/`.

## The URL trick

You swap the host: `github.com/oven-sh/bun/pull/30412` becomes
`diffshub.com/oven-sh/bun/pull/30412`. A Next.js catch-all route
(`apps/diffshub/app/[...path]`) takes the whole path and treats it as a GitHub
path.

`apps/diffshub/lib/normalizeGitHubPath.ts` first folds the tab suffixes away, so
`/pull/123/files` and `/pull/123/changes` both become `/pull/123`, and
`/pull/123/files/<sha>` becomes `/commit/<sha>`.
`apps/diffshub/lib/githubDiffSource.ts` then matches one of three shapes:

| Shape | Path |
| --- | --- |
| pull | `/{owner}/{repo}/pull/{number}` |
| commit | `/{owner}/{repo}/commit/{sha}` |
| compare | `/{owner}/{repo}/compare/{range}` |

## Where the data comes from

**Every GitHub request goes through diffshub's own server.** The browser never
talks to GitHub. Two Next.js route handlers do the fetching:

### `app/api/diff/route.ts` — the patch

The client calls `GET /api/diff?path=/owner/repo/pull/123`. The server appends
`.diff` and fetches `https://github.com/{path}.diff`
(`resolveGitHubPath`, line 327). It streams the response straight back, so the
client can parse and render files as they arrive instead of waiting for the
whole patch.

If the client sent a token, the server tries three targets in order:

1. the public `github.com/….diff` URL, unauthenticated
2. the same URL with `Authorization: Bearer <token>`
3. `api.github.com/repos/{owner}/{repo}/pulls/{n}` with the token

Five popular diffs are served from a CDN instead
(`CACHED_BLOBS`, line 27) — Linux `v6.0...v7.0` and similar.

### `app/api/github-diff-file/route.ts` — expanding context

Collapsed hunks need the surrounding file, which a `.diff` does not contain. The
client calls this route per file; it requires a token (401 without one) and
fetches `api.github.com/repos/{owner}/{repo}/contents/{path}` or
`raw.githubusercontent.com` (`lib/githubDiffFileServer.ts`, lines 420 and 433).

### The token

`components/useGitHubToken.ts` keeps an optional personal access token in
`localStorage` under `diffshub.github.token`. The comment there says the token
"is not sent anywhere until the loader explicitly reads it" — and the loader does
read it: `components/usePatchLoader.ts` (`createPatchRequestInit`) puts it in an
`Authorization: Bearer` header on the request **to diffshub.com**, which then
forwards it to GitHub.

So the site is accurate that the token is *stored* only in the browser, but on
every private-repo request the token itself and the full diff text both pass
through a third-party server. When no token is sent, the server falls back to
its own `DIFFSHUB_GITHUB_TOKEN` env var (`githubDiffFileServer.ts`, line 637), so
anonymous users share one rate-limit pool.

This is the thing our extension removes.

## How it renders

1. `lib/streamGitPatchFiles.ts` splits the incoming byte stream on file
   boundaries.
2. `processFile()` from `@pierre/diffs` parses each file's patch.
3. `lib/diffsHubDataAccumulator.ts` builds `CodeViewItem`s and the file-tree
   source side by side. Tree state is kept separate from item state on purpose,
   so an annotation change does not rebuild the tree.
4. `components/usePatchLoader.ts` publishes in batches: it keeps an 8 ms work
   budget per turn, yields to the browser, and flushes every 25 files or 100 ms
   (500 ms and a viewport-sized batch for the first flush). The tree flushes on
   its own slower schedule — 1000 files or 1000 ms.
5. `components/WorkerPoolContext.tsx` runs Shiki highlighting in up to three web
   workers (one on mobile), capped at `hardwareConcurrency - 1`.
6. `CodeView` virtualizes: it renders only what is near the viewport.

That pipeline — stream, batch, yield, virtualize, highlight off the main thread
— is why it stays smooth where GitHub does not. We get all of it from the
published `@pierre/diffs` package; none of it is tied to diffshub's server.

## What this means for the extension

The viewer is a library. The server is only a fetch proxy. We can drop the proxy
and keep the viewer.

**Patch.** A content script on `github.com` fetching
`https://github.com/{owner}/{repo}/pull/{n}.diff` is a same-origin request. The
user's existing session cookie rides along, so private repos work with no token
at all, and nothing leaves the browser. This is the whole point of the goal: no
credentials are shared because there is no third party to share them with.

**Expanding context.** This is the one place that needs more than the session
cookie. `api.github.com` is a different origin and does not accept the
github.com session cookie. Options, in the order we should consider them:

- fetch the blob from the github.com web origin, still same-origin and
  cookie-authenticated
- ask for an optional fine-grained token, keep it in `browser.storage`, and send
  it only to `api.github.com`
- ship without hunk expansion in the first version

**Streaming.** The site's speed depends on streaming the patch body. `fetch()` in
a content script gives us a `ReadableStream` directly, so we can reuse
`streamGitPatchFiles` as is. Routing through a background service worker would
cost us that stream — MV3 message passing does not carry one — so we should
fetch in the content script and use the background worker only where we need a
different origin.

**Workers and CSP.** `@pierre/diffs` spawns workers via
`new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url))`.
github.com's own CSP applies to a content script's isolated world for worker
creation, so the worker has to be loaded from an extension URL and listed under
`web_accessible_resources`. WXT handles the bundling; this still needs to be
tested against github.com's live CSP early, because it is the most likely thing
to break.

## Open questions

- Does the session cookie alone cover `.diff` on a private repo, and what does
  GitHub return for a PR too large to serve as a patch?
- Where does the button go on the PR page, and does the dialog need to survive
  GitHub's client-side navigation between tabs?
- Do we need comments and line selection in the first version, or is read-only
  fast enough to be worth shipping?
