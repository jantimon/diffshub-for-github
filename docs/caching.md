# Caching

What is kept, where, and what a push does to it.

## Why

One open of a forty-file pull request costs about 986 KB, and **740 KB of that
is the patch**, from `patch-diff.githubusercontent.com`, the one host that
answers 503 under load. Closing the overlay only hides the iframe for five
minutes, so reopening within that is free; a reload, a restored tab or GitHub's
own navigation to another pull request and back is not. The patch is a pure
function of the commit, so a copy keyed on the head sha takes most of that
traffic away.

## What happens on a request

```mermaid
flowchart TD
    A[cachedGithubFetch url, sha] --> B{sha known?}
    B -- no --> Z[plain githubFetch<br/>nothing read, nothing kept]
    B -- yes --> C{kept for this sha and url?}
    C -- yes --> F[unpack and replay as a stream]
    C -- no --> H[githubFetch]
    H --> I{ok?}
    I -- no --> J[return the failure<br/>404 and 503 are never kept]
    I -- yes --> K[pass the body through,<br/>keeping each chunk]
    K --> N{source ended<br/>of its own accord?}
    N -- no --> O[drop it]
    N -- yes --> P[when idle: gzip, base64, store]
```

The body passes through a transform rather than being split, so the parser is
the only thing pulling on github.com. A split stream pulls its source whenever
either half pulls, and a half read flat out would take the whole download while
the parser worked a few files a turn.

The same transform decides what finished means. Its `flush` runs only when the
source ends of its own accord: a body that stops short errors the stream, a
reader giving up cancels it, and neither can leave half a patch to be served
as the whole. On Firefox the patch arrives over a port from the background,
and the viewer treats a disconnect before `end` as an error for the same
reason.

## Where it is kept

`storage.session`: in memory, shared across tabs, gone when the browser closes.
Never `storage.local` or the Cache API, which would put private diffs on disk.

Preferences are a different matter and do stay: the viewer's own
`localStorage` holds the filter patterns, the layout and theme choices, and the
paths of the files ticked as viewed, per pull request. No diff content, and no
find query.

The background holds the patch cache in both browsers and the viewer asks over
`runtime.sendMessage`. Firefox would leave no choice, since it withholds
`browser.storage` from a viewer framed by github.com; Chrome's viewer has the
api, but one route means the Chrome suite runs the path Firefox uses. What
crosses is a string: Chrome's messaging is json, and bytes would not survive
it.

## Staleness

The key is the head sha, read from markup GitHub already embedded and passed to
the viewer on the iframe's url, so it is there before the download starts. A
page on a newer commit asks a different key and downloads. Without a sha the
cache is off.

The sha is the one the viewer opened with, not what the server answers now: a
page left open across a push downloads the new diff and keeps it under the old
key. The viewer is then ahead of the page, never behind it, and a reload
corrects the page. Without the cache the same thing shows; the cache only makes
it last.

## Limits

Stored compressed, 5.6 times smaller than the patch once base64 is paid for.
`storage.session` holds 10,485,760 bytes in all, and the cache keeps under 8 MB
of it. Before a write that would cross that it clears itself and
starts again, rather than keeping an index to evict the oldest entry. The usage
is counted before writing, so the bound holds whether or not the browser
enforces its quota.

## Not cached

- **Comments.** They change without a commit, and travel the content script's
  route.
- **Binary blobs** and **raw files for hunk expansion.** Blobs are unbounded,
  and dozens of small raw files would clear out the patch, which is the one
  entry worth keeping.
- **Anything that is not `ok`**, and anything that did not finish.

## Watching it

`pnpm dev` logs each decision to the viewer's console. Any other build does
after this, run in the viewer frame's console, and a page reload:

```js
localStorage.setItem('diffshub-for-github.debug', 'on');
```

## What it does not fix

A cold 503, and only the patch is asked again: raw files and blobs are asked
once. Nothing is kept for a commit that was never read. A 429, 502, 503
or 504 is asked again twice, after one second and then three, or after what
GitHub's `Retry-After` says up to ten; after that the refusal is shown.
