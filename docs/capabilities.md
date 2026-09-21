# What the overlay needs before it can replace GitHub's review page

A reviewer opens `/pull/{n}/changes`, reads the diff, leaves comments, ticks
files off and submits a verdict. The overlay replaces that page only when a
reviewer never has to go back to it. This lists what that takes, in three
groups, and ends with where each one stands.

**A review can now be done here from beginning to end**: read the diff, tick
files off, comment on a line, reply, resolve a conversation, and approve or
ask for changes. Every must-have is built. What is left is the comfort of
GitHub's page rather than its function -- ignoring whitespace, filtering the
tree by status, and suggested changes.

## Must have

Without any of these a reviewer has to leave the overlay, and once they leave
they have no reason to come back.

### Open and leave
1. **Open from the pull request page.** One click on the tab a reviewer already
   uses, no new URL to learn.
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
19. **Filter files by status** — added, modified, deleted, renamed.
20. **Filter files by glob**, to hide generated code and snapshots.
21. **Diff statistics** — files, additions, deletions, lines.
22. **Follow GitHub's theme**, and let the reviewer override it.
23. **Per-file actions** — copy path, open the file, blame.
24. **Compare binary files and images**, before and after.
25. **Render suggested changes**, and apply them.
26. **A pending review**, so comments are batched and submitted together rather
    than posted one at a time.
27. **Keyboard parity with GitHub**, so the keys a reviewer already knows work.
28. **Say when something fails**, per feature, without taking the diff down.

## Nice to have

Worth building once the rest holds.

29. **Review commit by commit** rather than the whole range.
30. **Link to a line**, so a reviewer can share what they are looking at.
31. **Search within the diff.**
32. **React to a comment.**
33. **Edit or delete your own comment.**
34. **Comment on a range of lines**, not a single one.
35. **Expand or collapse every file at once.**
36. **Remember where you were** in a pull request between visits.
37. **Image comparison modes** beyond side by side — swipe, onion skin.
38. **Jump to a definition** from a changed line.
39. **Who opened it.** The author's avatar in the header, with their details on
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
| 12 | Read existing review comments | ✅ | Inline, with outdated and resolved marked. GitHub stops at 350 threads |
| 13 | Write a review comment | ✅ | From the gutter control, posted at once, shown at its line |
| 14 | Reply to a comment | ✅ | Submits GitHub's own reply form, so no token is invented |
| 15 | Resolve a conversation | 🟡 | And reopen one, for conversations GitHub has loaded on the page behind the overlay; it renders the form for no others |
| 16 | Submit a review | ✅ | Comment, approve or request changes, from the toolbar |
| 17 | Mark a file viewed | ✅ | Both ways: what GitHub has is read on open, and every tick is sent back |

### Should have

| # | Capability | Status | Note |
| --- | --- | :---: | --- |
| 18 | Ignore whitespace | ❌ | Needs re-comparing hunks in the worker; `.diff` has no `w=1` |
| 19 | Filter files by status | ❌ | |
| 20 | Filter files by glob | ✅ | Include and exclude, remembered |
| 21 | Diff statistics | ✅ | With the split between additions and deletions |
| 22 | Follow GitHub's theme, with an override | ✅ | Light and dark, no automatic third state |
| 23 | Per-file actions | ✅ | Copy path, open the file, blame |
| 24 | Compare binary files and images | 🟡 | Head side only; the base side needs a revision the page does not carry |
| 25 | Render and apply suggested changes | ❌ | Bodies arrive as text, so suggestions read as raw markdown |
| 26 | A pending review | ❌ | Depends on 13 and 16 |
| 27 | Keyboard parity with GitHub | 🟡 | Navigation and viewed keys work; nothing for commenting or submitting |
| 28 | Say when something fails | ✅ | Toasts, and the diff keeps rendering |

### Nice to have

| # | Capability | Status |
| --- | --- | :---: |
| 29 | Review commit by commit | ❌ |
| 30 | Link to a line | ❌ |
| 31 | Search within the diff | ❌ |
| 32 | React to a comment | ❌ |
| 33 | Edit or delete your own comment | ❌ |
| 34 | Comment on a range of lines | ❌ |
| 35 | Expand or collapse every file at once | ❌ |
| 36 | Remember where you were | ❌ |
| 37 | Image comparison modes | ❌ |
| 38 | Jump to a definition | ❌ |
| 39 | The author's avatar in the header | ❌ |

### Count

| Group | ✅ | 🟡 | ❌ | Total |
| --- | :---: | :---: | :---: | :---: |
| Must have | 16 | 1 | 0 | 17 |
| Should have | 5 | 2 | 4 | 11 |
| Nice to have | 0 | 0 | 11 | 11 |
| **All** | **21** | **3** | **15** | **39** |

### Resolving depends on GitHub's page

Resolving posts to a conversation's own address, and its token is good for that
address alone -- a token from anywhere else is refused. The only source is the
form GitHub rendered for that conversation, and it renders them for the
conversations it has loaded, not for all of them. When the form is missing the
reader is told so and pointed at GitHub. Replying does not have this problem:
every reply posts to one shared action, so any reply form on the page serves.

## What to build next

Ignoring whitespace (18) is the one a reviewer will miss most: a reformatting
commit is unreadable without it, and GitHub's `.diff` endpoint offers no `w=1`,
so the comparison has to be redone in the worker.

After that, filtering the tree by status (19) and rendering suggested changes
(25), which needs comment bodies to be parsed rather than shown as text.

Viewed state now agrees in both directions: `page_data/file_tree` reports what
GitHub already has, so a file ticked on either side shows as ticked on the
other.
