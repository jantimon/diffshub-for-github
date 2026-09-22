<img src="docs/images/hero.png" alt="" width="100%">

# DiffsHub for GitHub

Review a GitHub pull request without waiting for it to render.

Click "Files changed" and the diff opens in a fullscreen viewer built on
Pierre's [`@pierre/diffs`](https://diffs.com) components, the same ones behind
[diffshub.com](https://diffshub.com). A 3,420-file pull request scrolls at
120 fps there. GitHub's own tab manages 12.

The whole review happens in it: read the diff, tick files off, comment on a
line, reply, resolve a conversation, approve or ask for changes. Every request
goes to github.com from your own browser on your own session cookie. No token,
no third-party server, nothing about the code leaves your machine.

A Chrome and Firefox extension, MV3, from one source tree.

![The overlay on nodejs/node#59805, dark](docs/images/overlay-dark.png)

## How you open it

The extension marks the "Files changed" tab with its icon and takes over the
click, so GitHub never renders its own diff. Most of the speed comes from not
rendering it.

![The marked Files changed tab](docs/images/files-changed-tab.png)

Cmd- or Ctrl-click the tab to get GitHub's view instead. `Esc` closes the
overlay and puts you back where you were — no navigation, no history entry, and
the URL never changes.

## Nothing leaves your browser

<img src="docs/images/direct-to-github.png" align="right" width="260" alt="">

diffshub.com already renders GitHub diffs far faster than GitHub does. To use it
you copy a URL, swap the host, and load the diff on a site that is not GitHub.
For a private repository you also paste a GitHub token into that site.

This extension gives you the same viewer without leaving GitHub. It runs inside
the GitHub tab, so there is no URL to rewrite, and every request goes to
github.com from your own browser on your own session cookie.

No token is stored, no third-party host is contacted, and no diff content leaves
the machine.

## Speed

Scrolling `nodejs/node#59805` — 3,420 files, 1.95M lines — over 180 frames:

| | Median frame | p95 | Worst | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| This viewer | 8.3 ms (120 fps) | 10.2 ms | 20 ms | 0 / 180 |
| GitHub's Files changed | 81.5 ms (12 fps) | 201.7 ms | 842 ms | 150 / 180 |

`pnpm test:fps` measures both and prints the table.

The patch streams, so the first file is readable long before the download ends.
The diff and the file tree are both virtualized: the number of elements on the
page tracks the window, not the 3,420 files.

## In the viewer

**A file tree you can cut down.** Two fields, one to include and one to exclude, with a count of what they hide. Generated code and snapshots stop getting in the way. The viewer remembers the patterns for the next pull request.

Each field reads what you type the way you meant it. Plain words match anywhere in the path, so `config` finds `src/ConfigFile.ts`; anything written like a glob stays a glob, so `src/**` and `*.test.*` mean what they always have. Two switches on the field, as in a code editor: **Aa** for case, **.*** for regular expressions. A clear button appears next to them once there is something to clear, and `Esc` does the same.

<img src="docs/images/exclude-filter.png" width="440" alt="The file tree with an exclude filter on, and the count of hidden files">

Here `deps/**, test/**` takes the same pull request down from 3,420 files to 45.

**Keys that match GitHub's.** `j` and `k` move between files, `n` and `p`
between hunks, `v` ticks a file off and moves to the next one, `/` jumps to the
tree filter, `?` shows the list, `Esc` closes the overlay.

![The shortcut help dialog](docs/images/shortcut-help.png)

**Your theme.** The overlay reads GitHub's active theme when it opens and
renders in a matching one, including the dimmed, high-contrast and colourblind
variants. A toolbar button switches light and dark on the spot. Light uses VS
Code's own default, which keeps every token above the contrast the WCAG asks
for.

![The overlay on the same pull request, light](docs/images/overlay-light.png)

**A whole review, without leaving.** Every conversation on the pull request is
read from GitHub, including the outdated ones its own page drops, and anchored
to the line it was written against. Select lines to write a comment, reply to a
thread, resolve or reopen any of them, and finish with a verdict — approve, request changes, or
comment. The comment box is GitHub's own formatting toolbar and GitHub's own
markdown preview, so what you see is what gets posted.

Every write goes to github.com on your session cookie, from the GitHub tab
itself. There is no token and no third party in the path.

**Reading a pull request twice is free.** The patch is kept, compressed, against
the commit it came from, so reopening one you have already read costs nothing —
and a push makes a new key, so what you are shown is never behind the page you
are on. It is gone when the browser closes. See
[`docs/caching.md`](docs/caching.md).

**The rest.** Split and unified layouts. Collapsed context expands in place —
the old side of a file is rebuilt from the patch, because GitHub serves raw
files only by commit sha and the base commit is not on the page. Copy path, open
the file, and blame, per file. A diff stats panel. Ticking a file off as viewed,
which marks it in the tree and marks the folder once all of it is read.
A toast when a GitHub response is not what the viewer expects, naming what
broke, while the diff keeps rendering.

## What is not built

- **Ignoring whitespace line by line.** A file that changed only in spacing can
  be hidden whole, but a file mixing a reformatting with a real edit shows
  both. Hiding the individual lines would renumber what is left, and a comment
  anchored to a renumbered line is a comment on the wrong code.
- **Applying a suggested change.** Suggestions render exactly as GitHub renders
  them, but the Commit button is still on GitHub.
- **Batching a review.** A comment written here is posted as it is written,
  the way a single comment is on GitHub, rather than held back until the
  review is submitted.

## Reading further

- [`AGENTS.md`](AGENTS.md) the short version of how this is built, and what to
  know before changing it
- [`docs/capabilities.md`](docs/capabilities.md) everything it takes to replace
  GitHub's review page, and where each piece stands. Every must-have is built
- [`docs/firefox.md`](docs/firefox.md) what Firefox does differently, and the
  traps. Each one cost real time to find
- [`docs/caching.md`](docs/caching.md) what is kept and where, why a stale diff
  cannot be served, and the measured limits
- [`research/github-internal-api/`](research/github-internal-api/) the
  undocumented API this extension runs on, read out of GitHub's own published
  sourcemaps. As far as we can tell, nobody else has written it down
- [`docs/analysis.md`](docs/analysis.md) how diffshub.com works, read from its
  own source in the submodule
- [`docs/todo.md`](docs/todo.md) open items, each with enough detail to pick up
  cold

## Requirements

- Node.js 22 or newer
- pnpm 10

## Getting started

```sh
pnpm install
pnpm dev             # Chrome, with hot reload
pnpm dev:firefox     # Firefox
```

`pnpm dev` starts [WXT](https://wxt.dev), which builds the extension and opens a
browser with it already loaded.

`pnpm dev:firefox` has no dev server behind it. Firefox will not run an
extension page's scripts from one, so the script builds on every change and
reloads the add-on instead. Reload the page to see the change: reloading the
add-on does not touch tabs already running the old one.
[docs/firefox.md](docs/firefox.md) has the why.

## Building

```sh
pnpm build           # -> .output/chrome-mv3
pnpm build:firefox   # -> .output/firefox-mv3
pnpm zip             # packaged for the Chrome Web Store
pnpm zip:firefox     # packaged for addons.mozilla.org
```

To load a build by hand: in Chrome, open `chrome://extensions`, turn on
Developer mode, and pick `.output/chrome-mv3` under "Load unpacked". In Firefox,
open `about:debugging`, choose "This Firefox", and load
`.output/firefox-mv3/manifest.json` as a temporary add-on.

Both targets come from one source tree. WXT writes the per-browser manifest, so
the code branches on the browser only where the platforms genuinely differ.

## Testing

Everything runs through a real browser against real github.com.

```sh
pnpm build && pnpm test   # the viewer, replayed from a recording: offline, no GitHub
pnpm test:live            # the same, against real github.com
pnpm test:record          # refresh the recording
pnpm test:review          # comments, replies, verdicts and viewed state: these write
pnpm test:firefox         # that the Firefox fetch path is still needed, and works
pnpm test:whitespace      # hiding files that changed only in spacing
pnpm test:units           # offline: old-side rebuild, whitespace, paths, recording safety, packing
pnpm test:fps             # frame times, against GitHub's own view
pnpm capture:readme       # the screenshots above, into docs/images
pnpm lint                 # oxlint, with every no-comment-slop rule on
pnpm format               # oxfmt, at Prettier's own defaults
```

`pnpm test` replays github.com from `test/har/`, so it needs no network and
cannot be throttled. Record it once with `pnpm test:record`, which runs signed
out against a public pull request and strips the credential headers GitHub
hands out anyway. The recording is gitignored, and `pnpm test:units` proves the
stripping works. Run
`pnpm test:live` now and then to catch GitHub changing under the recording.
`pnpm test:review` posts comments and submits reviews, so it runs against a
pull request kept for the purpose — pass another as an argument if you want a
different one. `pnpm test:units` needs no browser and no network.

The browser tests load `.output/chrome-mv3`, so build first. They launch
Chromium with the persistent profile in `test/.profile`, which is gitignored;
`pnpm test:login` opens a browser on that profile so you can sign in once, after
which private repositories are testable too. `DIFFSHUB_PROFILE` points at a
different profile, and `DIFFSHUB_FIREFOX_PROFILE` does the same for Firefox.
None of this runs in CI, and a test can break when a real pull request changes.
Both are the price of proving the session-cookie path against a real GitHub.

## Layout

The source is laid out by *where the code runs*, because that is the thing
that decides what each part is allowed to do.

```
src/bridge.ts                 what the two sides say to each other
src/pullRequest.ts            which pull request, and where its parts live
src/page/                     runs on github.com, as you: every write, and
                              everything read out of GitHub's own markup
src/viewer/                   runs on the extension's own origin
  files/                      fetching file contents in both browsers
  diff/                       the diff view, its styling and its workers
  comments/                   conversations, and the box for a new one
  review/                     the verdict, and which files are read
  shell/                      the frame: toolbar, sidebar, toasts, shortcuts
src/patch/                    a .diff becomes files, hunks and filters
src/entrypoints/              WXT's entry points, kept thin
public/                       files copied as-is
scripts/                      one-off helpers for development
docs/                         capabilities, Firefox, open items, README images
test/                         the browser suites and the offline checks
research/github-internal-api  what GitHub's undocumented API does
research/pierre               git submodule, read-only reference (see below)
```

The content script runs on github.com and can act as you. The viewer runs on
the extension's own origin, where GitHub treats it as a stranger: it refuses a
write from there, and Firefox will not even send the session cookie. So
anything that has to happen as you is named in `bridge.ts`, asked for over
`postMessage`, and carried out by the content script.

The viewer is an extension page rather than part of the content script, because
it needs the extension's own origin: github.com's CSP blocks a `blob:` worker,
and a page cannot build one from a `chrome-extension:` URL. On the extension
origin the Shiki worker is same-origin, the grammars load as split chunks, and
`fetch` to github.com is credentialed and CORS-exempt — which is what lets
rendering start before the download finishes. The page and the viewer talk over
`postMessage`.

## Research submodule

`research/pierre` is a shallow clone of
[pierrecomputer/pierre](https://github.com/pierrecomputer/pierre), the Apache-2.0
monorepo that holds `@pierre/diffs`, `@pierre/trees`, and the source of
diffshub.com itself (`apps/diffshub`). It is there to read, not to build
against — the extension depends on the published npm packages.

Clone with it:

```sh
git clone --recurse-submodules <this repo>
```

Or, in an existing clone:

```sh
git submodule update --init --depth 1
```

## Licence

MIT, Copyright (c) 2026 Jan Nicklas — see [LICENSE](LICENSE).

The build bundles the Pierre packages (`@pierre/diffs`, `@pierre/trees`,
`@pierre/icons`, `@pierre/theme`, `@pierre/theming`), which are Copyright 2025
Pierre Computer Company under the Apache License, Version 2.0. Their terms and
the full licence text are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
