# Working on this repo

A Chrome and Firefox MV3 extension that replaces GitHub's "Files changed" tab
with its own diff viewer, and lets a whole review happen there.

## The one thing to understand first

The code runs in **two places with different powers**, and the tree says so:

- `src/page/` runs on github.com in the content script, as the reader. Every
  write goes here.
- `src/viewer/` runs on the extension's own origin. It gets module workers and
  code splitting; GitHub treats it as a stranger and refuses its writes.
- `src/shared/bridge.ts` is the contract between them. A new request is an entry
  in its `Requests` table and in `failedReply` beside it, a handler in
  `src/entrypoints/content.ts`, and the function in `src/page/` that does the
  work. The compiler flags any of the first three that is missing. Every GitHub
  URL the page builds is in `src/page/routes.ts`, and every answer it reads
  is checked against a valibot schema in `src/page/githubApiSchemas.ts`. Keep
  those schemas loose: require only what the code uses, so a field GitHub adds
  changes nothing.
- `src/background/` is the background script: the toolbar button, and fetches
  and the cache for the viewer, after checking the sender.
- `src/patch/` is pure: a `.diff` becomes files, hunks and filters, and is
  packed small for the cache (`pack.ts`). It imports no browser API and uses
  relative `.ts` paths, never `@/`, so Node's test runner loads it as is.

No token, ever. Everything goes to github.com on the reader's own session
cookie.

## Commands

```sh
pnpm build && pnpm test   # the viewer, replayed from test/har: offline, no GitHub
pnpm test:live            # the same against real github.com, run it less often
pnpm test:review          # comments, replies, verdicts: writes to a throwaway PR
pnpm test:units           # offline, fast, no browser
pnpm lint                 # oxlint
pnpm format               # oxfmt, Prettier's options (see .oxfmtrc.json)
pnpm compile              # tsc --noEmit
```

CI (`.github/workflows/check.yml`) runs lint, format, types, the unit tests,
both builds and `web-ext lint`. The browser suites stay local: their recordings
do not leave the machine that made them.

`pnpm test:review` writes to `jantimon/diffshub-for-github#1` unless given
another pull request.

## How the tests work

> The more your tests resemble the way the software is used, the more
> confidence they can give you.

So the suites drive a real browser, with the real extension loaded, against
github.com's own answers: click the tab a reader clicks, press the keys they
press, write a comment and check GitHub kept it. There is no hand-written fake
of GitHub, no shallow rendering, and nothing calls an internal function to
prove a feature works. The answers are replayed from a recording by default
(below), and one check turns the first patch request into a 503 to prove the
retry.

The suite runs against a pull request of forty files across two languages,
chosen because the viewer recycles rows at that size. Ten files all stay
rendered, so the checks would never meet the row recycling where the bugs
that matter live.

A few things are unit tested instead, because a browser adds nothing to them
or cannot reach them: splitting a streamed patch into files, the file filters,
find (including gaps opened in a loaded file), rebuilding a file's old side and
spotting a spacing-only change (all checked against real `git diff` output),
pull request path matching, that a recording cannot keep credentials, and that
a large patch survives the cache's packing. They are in `test/unit/`, on Node's
own test runner, and `src/patch/` imports nothing that needs a browser, so all
of it loads there.

Some places knowingly reach past the interface. Each is a limit, not a
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
and it is the default because GitHub throttles a session that asks too often:
a day of automated runs is enough to get a 503 on every request, and the suite
cannot tell that from a bug, since both look like an empty diff. The patch
comes from a host of its own, `patch-diff.githubusercontent.com`, which refuses
while github.com keeps answering 200, so asking for the page says nothing about
whether the suite can run. Replaying keeps the traffic low enough that the
throttling does not start.

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

Styles sit next to the feature they dress, as a `.css` file in its folder, and
`src/entrypoints/viewer/style.css` imports them in cascade order. Styles for the
libraries' shadow DOM are strings, in `src/viewer/diff/styles/` and
`src/viewer/tree/treeStyles.ts`, because the libraries take them that way.

## Firefox

Firefox differs enough to have its own page. **Read
[docs/firefox.md](docs/firefox.md) before touching anything Firefox-related**,
including the dev server.

## Other docs

- [docs/lifecycle.md](docs/lifecycle.md) the order things happen in, from the
  click on "Files changed" to the first file, and what closing does. **Start
  here before reading `src/viewer/Overlay.tsx`**
- [docs/caching.md](docs/caching.md) what is kept and where, what a push does to
  it, and the measured ceilings. **Read it before changing anything that
  fetches**
- [research/github-internal-api/README.md](research/github-internal-api/README.md)
  what each route in `src/page/routes.ts` takes and answers
- [docs/todo.md](docs/todo.md) open items, each with enough detail to pick up cold
- [docs/capabilities.md](docs/capabilities.md) what it takes to replace GitHub's
  review page, and where each piece stands
- [docs/upstream.md](docs/upstream.md) where this works around Pierre's
  libraries, and the change to each that would end it
- [docs/analysis.md](docs/analysis.md) how diffshub.com works
