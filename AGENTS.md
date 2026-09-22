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

## How the tests work

> The more your tests resemble the way the software is used, the more
> confidence they can give you.

So the suites drive a real browser, with the real extension loaded, against
real github.com: click the tab a reader clicks, press the keys they press,
write a comment and check GitHub kept it. There is no mocked GitHub, no
shallow rendering, and nothing calls an internal function to prove a feature
works.

The suite runs against a pull request of forty files across two languages,
chosen because the viewer recycles rows at that size. Ten files all stayed
rendered, so the checks never met the recycling that several real bugs lived
in. Switching to forty broke a check on the first run, which is the point.

Four things are unit tested instead, because a browser adds nothing to them:
rebuilding a file's old side (checked against real `git diff` output), glob
matching, pull request path matching, and that a recording cannot keep
credentials. All four are pure functions with exact answers.

Four places knowingly reach past the interface. Each is a limit, not a
preference, and none should be copied without the same reason:

- **Asserting a write reached GitHub.** `review.mjs` watches for the response,
  because a comment appearing on screen does not prove GitHub accepted it.
- **Walking shadow roots.** The viewer library renders the diff, its headers
  and its rows into shadow DOM, and some of it cannot be reached by a locator.
- **Dispatching one click.** The send button inside a thread is visible and
  enabled, but the virtualiser re-measures rows constantly so it never counts
  as settled. The check asserts visible and enabled by hand, then dispatches.
- **Reading `scrollTop`.** The closest observable to "the diff moved", which is
  what a reader sees when they press `j`.

`pnpm test` replays recorded traffic. That is a step away from the real thing,
and it is the default for a reason worth knowing: a day of automated runs, with
agents pulling GitHub's bundles alongside them, earned the account a 503 on
every request. The suite could not tell that from a bug. Fifteen checks failed
with an empty diff, and the first guess was a change that had nothing to do
with it. The patch comes from a host of its own,
`patch-diff.githubusercontent.com`, which refuses while github.com keeps
answering 200, so asking for the page says nothing about whether the suite can
run.

Replaying also keeps the traffic down, which is what stops it happening again.

Going live has to be spelled out, so a script written in a hurry cannot reach
github.com by forgetting a variable. `pnpm test:live` is the same checks
against github.com and is the one that catches GitHub changing under the
recording. Run it before believing a green replay, and refresh the recording
with `pnpm test:record` when it drifts.

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
