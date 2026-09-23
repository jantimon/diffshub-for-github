# Open items

Things worth doing, with enough detail to pick up cold. Not a backlog of
everything: each of these was found and set aside deliberately.

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

## Smaller things

- `usePatchStream` never sets `phase` back to `loading` when the patch url
  changes, so a new patch would keep a stale `ready` or `error`. Unreachable
  today: the viewer gets one pull request and one commit per document.
- `readThreads` falls back to `databaseId ?? ''`. That id is what a reply names,
  so an empty one breaks replying, and nothing downstream handles it.
- `useViewed`'s set holds item ids from ticking and paths from GitHub. They
  coincide unless a patch names one path twice, when `uniqueId` returns
  `path?2`.
