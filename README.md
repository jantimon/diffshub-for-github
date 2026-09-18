# DiffsHub for GitHub

A Chrome and Firefox extension that adds a second diff viewer to GitHub pull
requests. You press a button on the PR page, a dialog opens, and the diff
renders in Pierre's virtualized [`@pierre/diffs`](https://diffs.com) components —
the same components behind [diffshub.com](https://diffshub.com).

GitHub's own "Files changed" tab stays where it is. This extension does not
replace it; it sits next to it.

## Why

diffshub.com already renders GitHub diffs far faster than GitHub does. To use it
you copy a URL, swap the host, and load the diff on a third-party site. For a
private repository you also paste a GitHub token into that site.

This extension keeps the viewer and drops the round trip:

- The viewer runs inside the GitHub tab, so there is no URL to rewrite.
- Every request goes to github.com or api.github.com from your own browser, with
  your own session. No diff content and no token reaches any other host.

## Status

Early. The repository holds the project setup, the research it is based on, and
the design. Nothing is implemented yet.

- [`spec.md`](spec.md) — what v1 is, decided in full
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

```sh
pnpm test          # Playwright, against real github.com
pnpm test:headed   # the same, with a visible browser
```

Tests are end-to-end only. They drive a persistent Chrome profile in
`test/.profile` with the built extension loaded, so they need you to log into
github.com in that profile once. The session cookie is the whole data path, so
there is nothing useful to test without it. These do not run in CI.

## Layout

```
entrypoints/     content scripts, background worker
components/      React components for the overlay and the viewer
utils/           GitHub fetching, parsing, storage
public/          icons and other files copied as-is
docs/            the analysis of diffshub.com
test/            Playwright end-to-end tests
research/pierre  git submodule, read-only reference (see below)
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
