# What the overlay needs before it can replace GitHub's review page

A reviewer opens `/pull/{n}/changes`, reads the diff, leaves comments, ticks
files off and submits a verdict. The overlay replaces that page only when a
reviewer never has to go back to it. This lists what that takes, in three
groups, and ends with where each one stands.

**A review can be done here from beginning to end**: read the diff, tick files
off, comment on a line, reply, resolve a conversation, and approve or ask for
changes. Every must-have is built. What is left is the comfort of GitHub's
page rather than its function -- ignoring whitespace line by line, applying a
suggested change, and holding a review back until it is submitted.

## Must have

Without any of these a reviewer has to leave the overlay, and once they leave
they have no reason to come back.

### Open and leave
1. **Open from the pull request page.** One click on the icon on the tab a
   reviewer already uses, no new URL to learn.
2. **A way back to GitHub's own view.** An escape hatch for anything the overlay
   cannot do, per file and for the whole pull request.
3. **Close without losing your place.** No navigation, no lost scroll position.

### Read the diff
4. **Every changed file, however large the pull request.** No cap, no "this diff
   is too big to show".
5. **Syntax highlighting**, split and unified.
6. **Expand collapsed context** around a hunk, and the whole file.
7. **Private repositories**, on the reviewer's own session. No token to paste.
8. **Chrome and Firefox.**

### Find your way around
9. **A file tree** with search.
10. **Keyboard navigation** between files and hunks.
11. **Renames and moves are obvious**, not silently shown as an unrelated pair.

### Review the code
12. **Read existing review comments** at the line they were left on, including
    outdated and resolved ones.
13. **Write a review comment** on a line.
14. **Reply to a comment.**
15. **Resolve a conversation.**
16. **Submit a review** — approve, request changes, or comment.
17. **Mark a file viewed**, and have GitHub agree, in both directions.

## Should have

A reviewer can work without these, but will miss them daily.

18. **Ignore whitespace.** A reformatting commit is unreadable without it.
19. **Filter files by name, glob or regular expression**, to hide generated code and snapshots.
20. **Diff statistics** — files, additions, deletions, lines.
21. **Follow GitHub's theme**, and let the reviewer override it.
22. **Per-file actions** — copy path, open the file, blame.
23. **Compare binary files and images**, before and after.
24. **Render suggested changes**, and apply them.
25. **A pending review**, so comments are batched and submitted together rather
    than posted one at a time.
26. **Keyboard parity with GitHub**, so the keys a reviewer already knows work.
27. **Say when something fails**, per feature, without taking the diff down.

## Nice to have

Worth building once the rest holds.

28. **Review commit by commit** rather than the whole range.
29. **Link to a line**, so a reviewer can share what they are looking at.
30. **Search within the diff.**
31. **React to a comment.**
32. **Edit or delete your own comment.**
33. **Comment on a range of lines**, not a single one.
34. **Expand or collapse every file at once.**
35. **Remember where you were** in a pull request between visits.
36. **Image comparison modes** beyond side by side — swipe, onion skin.
37. **Jump to a definition** from a changed line.
38. **Who opened it.** The author's avatar in the header, with their name on
    hover, so a reviewer knows whose work this is without leaving the overlay.

## Where each one stands

✅ done · 🟡 partly done · ❌ missing

### Must have

| # | Capability | Status | Note |
| --- | --- | :---: | --- |
| 1 | Open from the pull request page | ✅ | Takes over the Files-changed tab on both layouts |
| 2 | A way back to GitHub's own view | ✅ | Toolbar button, per-file links, and Cmd-click the tab |
| 3 | Close without losing your place | ✅ | No navigation, no history entry |
| 4 | Every changed file, however large | ✅ | 3,420 files stream and scroll at 120 fps |
| 5 | Syntax highlighting, split and unified | ✅ | Remembers the choice |
| 6 | Expand collapsed context | ✅ | Old side rebuilt from the patch; no base revision needed |
| 7 | Private repositories | ✅ | Session cookie only, verified in Chrome and Firefox |
| 8 | Chrome and Firefox | ✅ | One source tree, both MV3 |
| 9 | A file tree with search | ✅ | Resizable, marks viewed files |
| 10 | Keyboard navigation | ✅ | `j`/`k` files, `n`/`p` hunks, follows the scroll position |
| 11 | Renames and moves are obvious | ✅ | `MOVED` badge and the old path in blue |
| 12 | Read existing review comments | ✅ | Inline, with outdated and resolved marked. Walks both paginated routes, 40 a page, stopping at 800 and saying so |
| 13 | Write a review comment | ✅ | From the gutter control, posted at once, shown at its line |
| 14 | Reply to a comment | ✅ | The new-comment route, naming the comment it answers |
| 15 | Resolve a conversation | ✅ | And reopen one, for any conversation on the pull request, through `page_data/resolve_thread` |
| 16 | Submit a review | ✅ | Comment, approve or request changes, from the toolbar |
| 17 | Mark a file viewed | ✅ | Both ways: what GitHub has is read on open, and every tick is sent back |

### Should have

| # | Capability | Status | Note |
| --- | --- | :---: | --- |
| 18 | Ignore whitespace | 🟡 | Hides files that changed only in spacing, not single lines: [`whitespace.ts`](../src/patch/whitespace.ts) says why |
| 19 | Filter files by name, glob or regular expression | ✅ | Include and exclude, remembered along with the case and regex switches on each. A pattern written like a glob stays a glob; anything else matches anywhere in the path. A clear button inside the box, and `Esc`, empty a field |
| 20 | Diff statistics | ✅ | With the split between additions and deletions |
| 21 | Follow GitHub's theme, with an override | ✅ | Light and dark, no automatic third state |
| 22 | Per-file actions | ✅ | Copy path, open the file, blame |
| 23 | Compare binary files and images | ✅ | Images, both sides, against the commit the diff starts at. Shows the new file alone, and says so, when GitHub does not report that commit |
| 24 | Render and apply suggested changes | 🟡 | Shown as GitHub renders them. Applying one still happens on GitHub |
| 25 | A pending review | ❌ | A comment is posted as it is written rather than held back until the review is submitted |
| 26 | Keyboard parity with GitHub | 🟡 | Navigation and viewed keys work; nothing for commenting or submitting |
| 27 | Say when something fails | ✅ | Toasts, and the diff keeps rendering |

### Nice to have

| # | Capability | Status |
| --- | --- | :---: |
| 28 | Review commit by commit | ❌ |
| 29 | Link to a line | ❌ |
| 30 | Search within the diff | ✅ |
| 31 | React to a comment | ❌ |
| 32 | Edit or delete your own comment | ✅ |
| 33 | Comment on a range of lines | ❌ |
| 34 | Expand or collapse every file at once | ❌ |
| 35 | Remember where you were | ❌ |
| 36 | Image comparison modes | ❌ |
| 37 | Jump to a definition | ❌ |
| 38 | The author's avatar in the header | ✅ |

### Count

| Group | ✅ | 🟡 | ❌ | Total |
| --- | :---: | :---: | :---: | :---: |
| Must have | 17 | 0 | 0 | 17 |
| Should have | 6 | 3 | 1 | 10 |
| Nice to have | 3 | 0 | 8 | 11 |
| **All** | **26** | **3** | **9** | **38** |

### Resolving and replying take different routes

Resolving goes through `page_data/resolve_thread`, which takes the thread id
and the session cookie and nothing else, so it reaches every conversation on
the pull request. `unresolve_thread` reopens one. The request names the state
being asked for rather than toggling, because our idea of the current state is
stale the moment anyone else acts on the thread.

Replying goes through the route a new comment uses, `create_review_comment`,
with `inReplyTo` set to the database id of the comment it answers. GitHub files
the reply in that comment's thread, so like resolving it reaches every
conversation, not only those the page underneath has rendered.
