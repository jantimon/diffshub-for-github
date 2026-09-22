# Working on this repo

A Chrome and Firefox MV3 extension that replaces GitHub's "Files changed" tab
with its own diff viewer, and lets a whole review happen there.

## The one thing to understand first

The code runs in **two places with different powers**, and the tree says so:

- `src/page/` runs on github.com in the content script, as the reader. Every
  write goes here.
- `src/viewer/` runs on the extension's own origin. It gets module workers and
  code splitting; GitHub treats it as a stranger and refuses its writes.
- `src/bridge.ts` is the contract between them. One table: add a request there
  and a handler in `src/entrypoints/content.ts`, and nothing else.
- `src/patch/` is pure. A `.diff` becomes files, hunks and filters.

No token, ever. Everything goes to github.com on the reader's own session
cookie.

## Commands

```sh
pnpm build && pnpm test   # the viewer, replayed from test/har: offline, no GitHub
pnpm test:live            # the same against real github.com, run it less often
pnpm test:review          # comments, replies, verdicts: writes to a throwaway PR
pnpm test:units           # offline, fast, no browser
pnpm lint                 # oxlint
pnpm format               # oxfmt, Prettier's options at Prettier's defaults
pnpm compile              # tsc --noEmit
```

Write tests only against `jantimon/diffshub-for-github`.

## House rules

Comments say **why**, never what the code already says, and never narrate
history: no "used to", no "this fixes", no version numbers as rationale.
Prose follows Orwell's rules. `eslint-plugin-no-comment-slop` enforces the rest.

Measure before you claim. Several things here look wrong and are load-bearing;
each carries its reason in a comment. Do not remove one to satisfy a linter.

## Firefox

Firefox differs enough to have its own page. **Read
[docs/firefox.md](docs/firefox.md) before touching anything Firefox-related**,
including the dev server.

## Other docs

- [docs/todo.md](docs/todo.md) open items, each with enough detail to pick up cold
- [docs/capabilities.md](docs/capabilities.md) what it takes to replace GitHub's
  review page, and where each piece stands
- [docs/analysis.md](docs/analysis.md) how diffshub.com works
