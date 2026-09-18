# DiffsHub for GitHub — v1 spec

A Chrome and Firefox extension that replaces GitHub's Files-changed view with
Pierre's virtualized diff viewer, in a fullscreen overlay, without sending
anything to a third party.

## 1. Goal

GitHub's Files-changed tab is slow on large pull requests. diffshub.com renders
the same diffs far faster, but you have to leave GitHub and — for a private
repository — hand your token to another server.

This extension keeps the viewer and drops the round trip. The viewer runs in the
GitHub tab. Every request goes to github.com from the user's own browser on their
own session cookie. No token is stored, no third-party host is contacted, and no
diff content leaves the machine.

**Benchmark:** `nodejs/node#59805` — 3,420 files, 168,778 additions, 99,119
deletions, 1,952,384 lines. v1 works when that PR scrolls smoothly in the overlay
and GitHub's own tab struggles with it.

## 2. Scope

**In:** pull requests only — `/{owner}/{repo}/pull/{n}` and `/pull/{n}/files`.

**Out of v1:** commits, compare, PR commit sub-views, commit-scoped diffs within a
PR, pending/batched reviews, comment replies, a settings page.

## 3. Entry and exit

The "Files changed" tab is the only trigger. The extension marks it (a small
indicator next to the count) and takes over its click — including when it is
already the active tab.

```
Conversation   Commits   [Files changed 24 ⚡]
                                          ↑ always opens the overlay
```

| From | Behaviour |
| --- | --- |
| Conversation or Commits tab | Click is intercepted before Turbo navigates. GitHub never fetches or renders its diff. The overlay opens. The URL does not change. |
| Already on `/files` (pasted link, reload, Back) | GitHub renders its own view normally. Clicking the marked tab opens the overlay on top. |
| Cmd/Ctrl-click the tab | Real navigation to GitHub's Files-changed page. The escape hatch. |
| Close the overlay | Returns exactly where you were. No navigation, no history entry, no URL change. |

Blocking GitHub's own render on the click path is the single largest performance
win available — GitHub's rendering is most of the cost on a large PR. Accepting
that closing returns you to the Conversation tab is the price, and it is worth it.

The URL is never touched. There are no deep links to a line and no reopening on
reload.

## 4. Architecture

A content script runs on `github.com/*/*/pull/*`. It mounts one shadow root that
we own; React and the Pierre components render inside it.

```
github.com page
  └─ <div id="diffshub-root">
       └─ #shadow-root (ours, one)
            └─ React overlay
                 └─ <pierre-file-diff>
                      └─ #shadow-root (library's, per file)
```

`@pierre/diffs` registers a custom element that attaches an open shadow root per
rendered file (`packages/diffs/src/components/web-components.ts:21`), and its
virtualizer queries through those roots. We cannot have a single root and still
use the library. The virtualizer recycles those elements, so their count tracks
the viewport, not the file count.

**Fetching happens in the content script, never the background worker.** MV3
message passing cannot carry a `ReadableStream`, and losing the stream loses the
speed. A same-origin `fetch` from the content script sends the session cookie
automatically and returns a stream we can parse as it arrives.

## 5. Data

Everything comes from `github.com` on the existing session cookie. No token, no
`api.github.com`, no storage of credentials.

| What | Request |
| --- | --- |
| The patch | `GET /{owner}/{repo}/pull/{n}.diff` |
| Hunk expansion | `GET /{owner}/{repo}/raw/{sha}/{path}` |
| Existing comments | Read from the PR page DOM and GitHub's partials |
| Post a comment | `POST` to GitHub's web endpoint with the `authenticity_token` scraped from the page |
| Viewed state | Read and write GitHub's own state |

These web endpoints are undocumented and GitHub can change them without notice.
That is the accepted trade for zero setup and working private repos.

### When a scraped endpoint breaks

Degrade loudly, per feature. The diff keeps rendering; the specific broken
feature says what failed and links to GitHub's view for that action. Nothing
fails silently, and nothing takes the whole overlay down with it.

```
┌─ src/parser.ts ───────────────────────┐
│ @@ -1,4 +1,6 @@                        │
│ - const x = 1                          │
│ + const x = 2                          │
├────────────────────────────────────────┤
│ ⚠ Couldn't expand context — GitHub's   │
│   response changed shape.               │
│   [ Open this file on GitHub ]          │
└────────────────────────────────────────┘
```

If the `.diff` fetch itself fails — network, 404, rate limit, or GitHub refusing
a patch that large — show a toast naming the reason.

## 6. The overlay

Fullscreen. It covers GitHub entirely, which is deliberate: the user should
never be unsure whether they are looking at GitHub's viewer or ours.

```
┌────────────────────────────────────────────────────────┐
│ nodejs/node #59805                     12 / 3420 viewed │
│ deps: update V8 · 3,420 files +168,778 −99,119          │
│                          [↔] [↕] [¶] [⇱] [?] [✕]        │
├──────────────┬─────────────────────────────────────────┤
│ 🔍 filter  ⚙ │  ▾ deps/v8/src/compiler/machine-op.h    │
│              │  ┌────────── 178 unmodified lines ─────┐ │
│ ▾ deps/v8    │  179   // size of lhs, with the sizes  │ │
│   ▾ src      │  182 - typename intN_t = typename std  │ │
│     ▾ compil │  182 + typename intN_t = std::make_si  │ │
│       js-op… │                                          │
│       machin │  ▾ deps/v8/src/compiler/memory-lower.cc │
│       node-m │  ┌────────── 198 unmodified lines ─────┐ │
│              │  202 - static_assert(std::is_same<Smi… │ │
├──────────────┤  202 + static_assert(std::is_same_v<S… │ │
│ Diff Stats   │                                          │
│ Files  3,420 │                                          │
│ Adds 168,778 │                                          │
│ Dels  99,119 │                                          │
│ Lines 1.95M  │                                          │
└──────────────┴─────────────────────────────────────────┘
```

**Header** — repo, PR number, title, branch pair, diff stats, and viewed progress
(`12 / 3420 viewed`).

**Toolbar** — split/unified, expand/collapse all, ignore-whitespace, open on
GitHub, keyboard-shortcut help, close.

**Sidebar** — `@pierre/trees` file tree with name search and status filter (added
/ modified / deleted). On a 3,420-file diff the tree is unusable without them.
Below it, the Diff Stats panel, fed by the streaming accumulator.

**Diff** — split by default. Collapsed context appears as a clickable
`N unmodified lines` bar, which is the hunk-expansion trigger. All files start
expanded.

No System Monitor and no settings page.

### Loading

Files appear as they stream in, with a running count in the header. The first
file is readable almost immediately.

### Theme

Read GitHub's active theme from `<html data-color-mode>` / `data-dark-theme`
when the overlay opens, and map it onto the matching Pierre theme — light, dark,
dimmed, high-contrast, colourblind. Measured at open time; no live following.

### Layout memory

Split by default. Whichever of split/unified the user last chose persists in
`localStorage`. The toggle is the setting; there is no settings page.

### Keyboard

Matches GitHub's review keys, so there is nothing new to learn.

| Key | Action |
| --- | --- |
| `j` / `k` | next / previous file |
| `n` / `p` | next / previous hunk |
| `v` | toggle Viewed on the current file |
| `/` | focus the file-tree filter |
| `?` | shortcut help overlay |
| `⌘↩` | submit comment |
| `Esc` | close the overlay |

## 7. Features

### Viewed state

Read GitHub's real state on open. Ticking updates the UI at once and writes back
in the background. If the write fails, revert the tick and show a toast. GitHub's
own tab and the overlay never silently disagree.

### Ignore whitespace

GitHub's `.diff` endpoint takes no `?w=1`, so the patch always includes
whitespace changes. The toggle re-compares hunks in the worker and drops lines —
and files — that differ only in spacing. No refetch. The result may differ
slightly from GitHub's own `w=1` on mixed tabs and spaces or a changed trailing
newline.

### Exclude filter

A second input in the sidebar takes glob patterns and hides the files that match
them. Generated code and test files are the common cases.

```
┌────────────────────────────────┐
│ 🔍 filter files…               │
│ ⊘ *.generated.ts, **/*.test.*  │
├────────────────────────────────┤
│ ▾ src                          │
│     parser.ts                  │
│     client.ts                  │
│   (412 files hidden)           │
└────────────────────────────────┘
```

Patterns are comma- or newline-separated and matched with
[`picomatch`](https://github.com/micromatch/picomatch) — 4.0.7, zero
dependencies, no node builtins, `sideEffects: false`, and it ships a `posix`
entry that forces forward-slash semantics, which is what git paths always use.
Its only reference to `process` is a guarded `typeof process !== 'undefined'`
check, so it runs in a content script unchanged.

Compile the patterns once per change into a single matcher and apply it in the
accumulator, so excluded files never reach the tree or the viewer at all rather
than being rendered and hidden. The header shows how many are hidden, so a
filter is never silently eating half the diff.

An invalid pattern shows an inline error and filters nothing — it does not throw
away the view you already have.

Patterns persist in `localStorage` alongside the layout choice. `**/*.test.*` is
a standing preference, not a per-PR decision.

### Comments

Existing threads render inline at their line, through the `@pierre/diffs`
annotation framework.

```
  41 │   const parse = (s) => {
  42 │ -   return JSON.parse(s)
  43 │ +   return safeParse(s)
     │   ╭──────────────────────────────╮
     │   │ @reviewer                     │
     │   │ Does safeParse throw?         │
     │   ╰──────────────────────────────╯
  44 │   }
```

Comments anchored to lines no longer in the diff — GitHub calls these outdated —
render at the start of the file they belong to, marked as outdated.

Writing is one comment at a time, posted immediately, exactly like GitHub's "Add
single comment". No drafts, no pending review state, no replies in v1.

Posting needs GitHub's notion of a position, computed from the patch we parsed.
Where we cannot compute a trustworthy anchor — inside a whitespace-filtered
region, for instance — the comment affordance does not appear, and a tooltip
points at GitHub's view. **A comment this extension posts is never attached to
the wrong line.**

### Binary files and images

The patch carries no binary content, only "Binary files differ". Every binary
file is listed in the tree and the diff with a direct link for manual
comparison. Image files also get a Compare button, opening an inner dialog
showing before and after side by side with dimensions and sizes. Side-by-side
only in v1.

### Per-file links

Copy path, open the file at this ref, and blame — the links people use to leave
the diff for the rest of GitHub.

### Large diffs

Always try. Always stream. Never cap and never ask first. The virtualizer and
the streaming parser are the answer; if a browser dies on a two-million-line
diff, that was the user's call.

## 8. Build order

Two spikes first, because either can change the design.

**Spike 1 — worker and CSP.** Mount a bare `CodeView` in a shadow root on a real
github.com PR with one hardcoded file and create the Shiki worker from an
extension URL listed in `web_accessible_resources`. Watch the console for a CSP
violation. This is the only question that can invalidate the architecture, so it
goes first. If it fails, revisit the extension-origin iframe and main-thread
highlighting before building anything else.

**Spike 2 — fetch and stream.** Fetch `node#59805`'s `.diff` from a content
script on the session cookie and stream-parse it, logging files as they arrive.
No UI. This proves the no-credentials claim and settles the streaming question.

Streaming ships from the start if the spike shows it is straightforward —
diffshub's `usePatchLoader` is in the submodule to read from. If it is not, fall
back to a skeleton-then-render path and add streaming after, accepting that the
benchmark PR will not work until it lands.

Then: overlay shell and tab interception → file tree → hunk expansion → viewed
state → whitespace filter → comments read → comments write → binary and image
handling.

## 9. Testing

E2E only.

> The more your tests resemble the way your software is used, the more confidence
> they can give you. Tests only break when your app breaks, not implementation
> details. Interact with your app the same way as your users.

Playwright, launching a persistent Chrome profile with the unpacked extension
loaded, driving real github.com.

```
test/.profile/     gitignored, logged into github.com once

launchPersistentContext('test/.profile', {
  args: [`--disable-extensions-except=${dist}`,
         `--load-extension=${dist}`],
})
```

This cannot run in CI and a test can break when a real PR changes. Both are
accepted: the session-cookie path, private repos, viewed-state writes and posting
a comment are only provable against a real GitHub.

### Manual and agent-driven testing

`pnpm dev` launches Chrome with the extension loaded and hot reload.
`pnpm dev:firefox` does the same through `web-ext`.

A project-scoped `.mcp.json` configures chrome-devtools-mcp to launch Chrome with
the built extension and a persistent profile, so the frame timings behind the FPS
claim can be measured directly and CSP violations can be read off the console.

## 10. Stack

WXT 0.21, React 19, TypeScript 7, picomatch 4, pnpm 10. One source tree; `pnpm build` and
`pnpm build:firefox` produce `chrome-mv3` and `firefox-mv3`. Distribution is
personal and unpacked — no store listing, no privacy policy, no review.

`research/pierre` is a read-only submodule of `pierrecomputer/pierre`, holding
`@pierre/diffs`, `@pierre/trees`, and diffshub.com's own source. The extension
depends on the published npm packages, not the submodule.

## 11. Risks

| Risk | Impact | Response |
| --- | --- | --- |
| github.com CSP blocks the Shiki worker | Architecture changes | Spike 1, before anything else |
| Scraped web endpoints change | Comments, viewed state, expansion break | Degrade loudly per feature; the diff keeps working |
| Turbo click interception breaks on a GitHub redesign | Overlay stops opening | Cmd-click and the real `/files` page always work |
| Client-side whitespace filter diverges from GitHub | Wrong lines shown or hidden | Commenting is disabled where anchoring is uncertain |
| Comment anchored to the wrong line | Wrong comment on a real PR | Refuse to offer commenting rather than guess |
| A two-million-line diff kills the tab | Lost work | Accepted; streaming and virtualization are the mitigation |
