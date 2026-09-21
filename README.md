<img src="docs/images/hero.png" alt="" width="100%">

# DiffsHub for GitHub

A Chrome and Firefox extension that opens GitHub pull request diffs in a fast,
virtualized viewer. Click the "Files changed" tab and the diff renders in
Pierre's [`@pierre/diffs`](https://diffs.com) components — the same components
behind [diffshub.com](https://diffshub.com) — in a fullscreen overlay.

A 3,420-file pull request scrolls at 120 fps. GitHub's own tab manages 12.

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

**A file tree you can cut down.** Two glob fields, one to include and one to
exclude, with a count of what they hide. Generated code and snapshots stop
getting in the way. The viewer remembers the patterns for the next pull
request.

<img src="docs/images/exclude-filter.png" width="440" alt="The file tree with an exclude filter on, and the count of hidden files">

Here `deps/**, test/**` takes the same pull request down from 3,420 files to 45.

**Keys that match GitHub's.** `j` and `k` move between files, `n` and `p`
between hunks, `v` ticks a file off and moves to the next one, `/` jumps to the
tree filter, `?` shows the list, `Esc` closes the overlay.

![The shortcut help dialog](docs/images/shortcut-help.png)

**Your theme.** The overlay reads GitHub's active theme when it opens and maps
it onto the matching Pierre theme, including the dimmed, high-contrast and
colourblind ones. A toolbar button switches light and dark on the spot.

![The overlay on the same pull request, light](docs/images/overlay-light.png)

**The rest.** Split and unified layouts. Collapsed context expands in place —
the old side of a file is rebuilt from the patch, because GitHub serves raw
files only by commit sha and the base commit is not on the page. Copy path, open
the file, and blame, per file. A diff stats panel. Ticking a file off as viewed,
which marks it in the tree and marks the folder once all of it is read.
A toast when a GitHub response is not what the viewer expects, naming what
broke, while the diff keeps rendering.

## What is not built

- **Writing anything.** Existing comments are shown at the line they were left
  on, but you cannot write one, reply, resolve a conversation or submit a
  review. Finish a review on GitHub's own tab.
- **Reading viewed state back.** A tick is sent to GitHub, so its Files-changed
  tab agrees. The reverse does not work: files ticked on GitHub do not show as
  ticked here.
- **Ignore whitespace.** GitHub's `.diff` endpoint takes no `?w=1`, and the
  client-side comparison to replace it is not written.
- **Filtering the tree by status.** Added, modified and deleted are shown, not
  filtered on.
- **The before side of a binary comparison**, which needs a base revision the
  pull request page does not carry.

[`docs/capabilities.md`](docs/capabilities.md) lists everything it takes to
replace GitHub's review page and where each piece stands.
[`spec.md`](spec.md) has the full plan, and
[`docs/analysis.md`](docs/analysis.md) records how diffshub.com works, read
from its own source in the submodule.

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
pnpm build && pnpm test   # the overlay, end to end
pnpm test:fps             # frame times, against GitHub's own view
pnpm test:units           # rebuilding the old side of a file, against real git diffs
pnpm capture:readme       # the screenshots above, into docs/images
```

The browser tests load `.output/chrome-mv3`, so build first. They launch
Chromium with the persistent profile in `test/.profile`, which is gitignored.
Sign in to github.com there once and private repositories become testable too.
None of this runs in CI, and a test can break when a real pull request changes.
Both are the price of proving the session-cookie path against a real GitHub.

## Layout

```
src/entrypoints/content.ts    marks the tab, takes over its click, mounts the viewer
src/entrypoints/viewer/       the viewer, an extension page
src/github/                   reading github.com: the page, its theme, its files
src/patch/                    streaming the patch, parsing it, filtering it
src/ui/                       the overlay and its parts
public/                       files copied as-is
docs/                         the analysis of diffshub.com, and the README images
test/                         browser tests and the reconstruction check
research/pierre               git submodule, read-only reference (see below)
```

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
