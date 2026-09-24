# Lifecycle

What happens from a click on "Files changed" to the first file on screen, and
what happens when the viewer is closed. Each step names the function that does
it.

## Opening

```mermaid
sequenceDiagram
    autonumber
    actor Reader
    participant CS as Content script<br/>entrypoints/content.ts
    participant V as Viewer iframe<br/>Overlay.tsx
    participant BG as Background<br/>entrypoints/background.ts
    participant GH as github.com

    Reader->>CS: clicks Files changed
    Note over CS: capture listener, findFilesChangedLink<br/>preventDefault, then open(pr)
    CS->>CS: readHeadSha(), readGitHubTheme()
    CS->>V: iframe src viewer.html?owner&repo&number&sha&theme
    Note over CS: html overflow hidden, takeFocus()

    Note over V: main.tsx checks sha, renders Overlay
    Note over V: createSession(storedViewed(key, sha))<br/>ticks from localStorage, theme from the url<br/>toolbar, empty tree, "loading…"

    V->>CS: ready (usePageInfo)
    CS->>V: focus
    CS->>V: page-info: title, themes, branches, author

    par patch
        V->>BG: cache get (readCached)
        alt kept for this sha and url
            BG-->>V: packed patch
            Note over V: unpack(), replayed as a stream
        else not kept
            V->>GH: GET /pull/N.diff (githubFetch, via BG on Firefox)
            GH-->>V: body, streamed through capture()
        end
        loop each file (streamPatchFiles)
            Note over V: appendFile, publish() on the first file,<br/>then every 25 files or 100 ms
            Note over V: session.visible, then CodeView draws,<br/>useTreeModel adds rows
        end
        Note over V: phase ready
        V->>BG: cache set, when idle (store)
    and viewed ticks
        V->>CS: request viewed (useViewed)
        CS->>GH: page_data/file_tree
        GH-->>CS: diffs[].markedAsViewed, baseRefOid
        CS-->>V: response: paths, baseSha
    and conversations
        V->>CS: request threads (useThreads)
        CS->>GH: page_data/thread_previews, page_data/threads
        CS-->>V: response: threads
    end
```

The three requests after `ready` do not wait for each other. The first file
usually shows before the ticks or the conversations arrive, and each lands
on the diff when it comes.

| When | What is on screen |
| --- | --- |
| Click | The iframe, empty, over the page |
| First render | Toolbar, empty tree, "loading…", in the theme from the url, with the ticks kept in this browser |
| `page-info` | The title and GitHub's own theme names |
| First file parsed | The first file and its tree row; highlighting follows from the workers |
| Every 25 files or 100 ms | More files and rows |
| Patch ends | "loading…" goes, `data-dh-phase="ready"` |
| `viewed` answers | GitHub's ticks replace the kept ones, unless the reader ticked something meanwhile |
| `threads` answers | Conversations at their lines |

## Closing and coming back

```mermaid
stateDiagram-v2
    [*] --> Showing: open(pr)
    Showing --> Hidden: close (Esc or button)<br/>hide()
    Hidden --> Showing: open(pr) again<br/>same frame, patch kept
    Hidden --> [*]: 5 minutes pass<br/>destroy()
    Showing --> [*]: route to another pull request<br/>destroy()
    Hidden --> [*]: route to another pull request<br/>destroy()
```

A frame that was destroyed is built again on the next open. The patch then
comes from the cache when the page is on the same commit (`docs/caching.md`).
