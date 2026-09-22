# Open items

Things worth doing, with enough detail to pick up cold. Not a backlog of
everything: each of these was found and set aside deliberately.

## Diff line contrast

Raise the mix so the added and deleted tints sit lighter behind the code:

```
--mix-light: 95%   (currently 88%)
--mix-dark:  94%   (currently 80%)
```

`@pierre/diffs` sets these on `[data-line], [data-no-newline]` inside
`:where([data-background])` (`research/pierre/packages/diffs/src/style.css:464`).
They are in its shadow root, so the override goes in `codeViewStyles.ts`
alongside `HEADER_CSS`, not in `viewer/style.css`.

Both values were tried in the browser before being written down, so take them
as given. The dark side reads 80% in the library today, not 88%.

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
