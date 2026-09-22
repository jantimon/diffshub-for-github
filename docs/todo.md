# Open items

Things worth doing, with enough detail to pick up cold. Not a backlog of
everything: each of these was found and set aside deliberately.

## Edit and delete your own comment

Capability 32. Both routes are measured and working:

```
PUT    …/page_data/update_review_comment   {body, commentId}  -> 200 {bodyVersion}
DELETE …/page_data/review_comments/:id                        -> 204
```

Delete is **commented out of GitHub's own client registry** yet still answers,
so it is the likeliest of our routes to disappear. It must fail loudly.

Once this exists, `test/review.mjs` can delete what it wrote through the
extension, and the cleanup doubles as coverage. Submitted reviews still cannot
be removed by anyone, so the fixture pull request needs replacing now and then.

## Viewed state from another tab is lost

`useViewed` sets a `touched` latch on the first tick and never clears it, so
GitHub's list is merged only once per session. Tick a file on GitHub in another
tab and the viewer never notices. Re-reading on `visibilitychange` is about six
lines; the read costs `page_data/file_tree`, which is over a megabyte on a large
pull request, so do not do it on every focus.

## Nothing retries a refused request

`patch-diff.githubusercontent.com` answers 503 under load, often enough that the
test harness grew pacing, a pre-flight check and a refusal watch to work around
it (`test/browser.mjs`). **None of that exists in the extension.** A 503 on the
patch goes straight from `usePatchStream` to an error toast and the reader is
left to press reload themselves.

The cache does not help here and cannot: nothing is kept for a commit that was
never read successfully, so a first open is fully exposed. See
[caching.md](caching.md).

Retry with backoff belongs in `cachedGithubFetch`, which is already the one place
every read passes through and already tells a refusal from an answer. Only
retry what is worth retrying — 429, 502, 503, 504, the set `test/browser.mjs`
already names as `REFUSED` — and give up loudly rather than quietly.

## `serveGithubFetch` validates nothing

`src/viewer/files/githubFetch.ts:138` fetches whatever url arrives on the port,
verbatim, with `credentials: 'include'`, and never reads `port.sender`.
`GITHUB_ORIGINS` in `src/entrypoints/background.ts:4` looks like it guards this
and does not — it is only used for the toolbar badge's permission check.

So anything able to open that port gets a credentialed streaming proxy to any
origin the extension holds host permissions for. The blast radius is small
today: the port exists on Firefox alone, `viewer.html` is web-accessible only to
`https://github.com/*`, and host permissions are the two GitHub origins. Every
one of those is incidental rather than enforced.

A sender check against `browser.runtime.getURL('/viewer.html')` and an origin
allowlist is a few lines. Worth doing **before** anything moves Chrome onto the
same port, which would hand Chrome the same capability.

## Splitting the patch body costs backpressure

`cachedGithubFetch` uses `response.body.tee()`: one half to the parser, one to
the cache. A split stream pulls its source whenever either half pulls, so the
cache's half — which reads flat out — takes the network at full speed while the
parser works to an 8 ms budget, and the gap queues in memory. Measured with a
200-chunk source and a slow reader: 10 chunks produced without the split, all
200 with it.

Before, an unread `fetch` body filled the pipe and the network service stopped
reading the socket, so memory was bounded by how fast the parser went. That is
gone. On a 20 MB patch: the queue, plus the whole text in `absorb`, plus the
Blob copy, plus gzip's output, plus the base64 string. Worse than the memory is
the timing — compressing and base64ing and a multi-megabyte storage write all
land on the main thread **during** the progressive render, which is the thing
the 8 ms budget exists to protect.

The fix is to stop splitting. `usePatchStream` already holds the whole patch, so
let the parser collect the text it has already decoded and hand it over once
`streamPatchFiles` returns normally and the signal is not aborted, inside
`requestIdleCallback`. Backpressure comes back, the packing happens after the
render rather than inside it, and completeness becomes the parser's own signal
instead of the transport's — which would also retire the framing argument in
[caching.md](caching.md).

## Push detection may never fire

`content.ts` re-reads `readHeadSha()` on `visibilitychange` to notice a push, and
that reads JSON GitHub embedded in the page. **Nobody has confirmed GitHub ever
rewrites that JSON without a navigation.** If it does not, the value is frozen at
load, the toast never appears, and the whole "noticed but not applied" path is
dead code that reads as though it works.

Check it live: open a pull request, push to it from elsewhere, switch tabs back,
and see whether the toast arrives. If it does not, either drop the feature or
find something on the page that does change.

## One highlighting worker fails to start

`pnpm test` reports `Worker error: Event {... pendingSetupRequestId: req_1,
initialized: false ...}` once per run. Bisected to the commit that added the
cache, reproducibly, against the same profile and recording; the commit before
it is silent.

What it is not: the worker asset is byte-identical to the one built before that
commit, the `storage` permission is not the cause (removing it changes nothing),
and **highlighting works** -- tokens carry their `--diffs-token-*` properties, so
the pool carries on with its other workers. It costs a console line, not a
feature.

The likely shape is timing. The cache adds a storage read before the patch
request, which moves when the first items reach `CodeView` relative to the pool
setting itself up, and a diagnostic run showed two setup requests (`req_1` and
`req_2`) rather than one. Worth confirming before doing anything about it, and
worth remembering that the worker asset has unresolved bare imports
(`import { createHighlighterCore } from "shiki/core"`), which a module worker
cannot resolve on its own -- that may be the underlying fragility.

## The Firefox storage tier is unverified

The cache picks a store at runtime, and Firefox's viewer is refused
`browser.storage`, so it should land on the background tier. That was built from
one console line, never from a run: `pnpm test:firefox` needs a profile signed in
to github.com, and a throwaway profile could not reach github.com at all.

Reload the viewer with `diffshub-for-github.debug` set and read the first line.
`keeping what github.com answers in the background` is the expected one; `in none`
means the background cannot reach storage either and the third tier, the page's
own `sessionStorage`, is what is carrying it.

## Smaller things

- `usePatchStream` never sets `phase` back to `loading` when the patch url
  changes, so a new patch keeps a stale `ready` or `error`. Probably
  unreachable: the viewer gets one pull request per document.
- `readThreads` falls back to `databaseId ?? ''`. That id is what a reply names,
  so an empty one breaks replying, and nothing downstream handles it.
- `useViewed`'s set holds item ids from ticking and paths from GitHub. They
  coincide unless a patch names one path twice, when `uniqueId` returns
  `path?2`.
- `content.ts` calls a variable `markedPath` which holds a pull request number.
