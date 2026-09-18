# DiffsHub for GitHub

A Chrome and Firefox extension that opens GitHub pull request diffs in a fast,
virtualized viewer. Click the "Files changed" tab and the diff renders in
Pierre's [`@pierre/diffs`](https://diffs.com) components — the same components
behind [diffshub.com](https://diffshub.com) — in a fullscreen overlay.

Cmd- or Ctrl-click the tab for GitHub's own view.

## Why

diffshub.com already renders GitHub diffs far faster than GitHub does. To use it
you copy a URL, swap the host, and load the diff on a third-party site. For a
private repository you also paste a GitHub token into that site.

This extension keeps the viewer and drops the round trip:

- The viewer runs inside the GitHub tab, so there is no URL to rewrite.
- Every request goes to github.com from your own browser on your own session
  cookie. No token is stored, no third-party host is contacted, and no diff
  content leaves the machine.

Scrolling `nodejs/node#59805` — 3,420 files, 1.95M lines — over 180 frames:

| | Median frame | p95 | Worst | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| This viewer | 8.3 ms (120 fps) | 10.2 ms | 20 ms | 0 / 180 |
| GitHub's Files changed | 81.5 ms (12 fps) | 201.7 ms | 842 ms | 150 / 180 |

## Status

Working. The overlay streams the patch, renders the diff and the file tree,
expands collapsed context, filters files by glob, and follows GitHub's theme.
Viewed state, comments and the ignore-whitespace toggle are not built yet.

- [`spec.md`](spec.md) — what v1 is, and what is built
- [`docs/analysis.md`](docs/analysis.md) — how diffshub.com works today, read
  from its own source in the submodule

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

Both targets are built from one source tree. WXT writes the per-browser
manifest, so the code does not branch on the browser except where the platforms
genuinely differ.

## Testing

Everything is driven through a real browser against real github.com.

```sh
pnpm test            # the overlay, end to end
pnpm test:fps        # frame times, against GitHub's own view
pnpm test:units      # rebuilding the old side of a file, against real git diffs
```

The browser tests launch Chromium with the unpacked extension and the persistent
profile in `test/.profile`, which is gitignored. Sign in to github.com there once
and private repositories, viewed state and comments become testable too. None of
this runs in CI.

Build first — the tests load `.output/chrome-mv3`:

```sh
pnpm build && pnpm test
```

## Layout

```
src/entrypoints/content.ts    marks the tab, takes over its click, mounts the viewer
src/entrypoints/viewer/       the viewer, an extension page
src/github/                   reading github.com: the page, its theme, its files
src/patch/                    streaming the patch, parsing it, filtering it
src/ui/                       the overlay and its parts
public/                       files copied as-is
docs/                         the analysis of diffshub.com
test/                         browser tests and the reconstruction check
research/pierre               git submodule, read-only reference (see below)
```

## Research submodule

`research/pierre` is a shallow clone of
[pierrecomputer/pierre](https://github.com/pierrecomputer/pierre), the Apache-2.0
monorepo that holds `@pierre/diffs`, `@pierre/trees`, and the source of
diffshub.com itself (`apps/diffshub`). It is here to read, not to build against —
the extension depends on the published npm packages.

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
