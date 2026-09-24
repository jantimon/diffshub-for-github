# Firefox

What differs from Chrome, and the traps.

## Runtime

**Total Cookie Protection partitions the viewer's cookies.** The viewer is an
extension iframe inside a github.com page, so its cookie jar is keyed by the
top-level site and every github.com request from it leaves signed out. A
private patch gets 404 there and 200 through the background script.
`src/viewer/net/githubFetch.ts` proxies through the background on Firefox
only, streamed in chunks so rendering stays progressive.

**Do not remove that proxy because a test says it is unneeded.** A profile with
`network.cookie.cookieBehavior` at 4 has the feature off. Firefox defaults to 5.
Playwright's own profile ships 4, which makes the proxy look pointless.
`test/firefox.mjs` pins the real default.

**Background is an event page**, `scripts: [background.js]`, not a service
worker. AMO needs the add-on id and `data_collection_permissions` in
`wxt.config.ts`.

**Host access can be revoked after install.** `src/background/hostAccess.ts`
watches `browser.permissions` and marks the toolbar button when it goes.

## Development

**There is no dev server for Firefox, and there cannot be.** Firefox will not
run an extension page's scripts from a remote origin, so every script the dev
server serves is refused and the viewer renders as a white panel. The Browser
Console names the real cause:

```
Content-Security-Policy: The page's settings blocked a script (script-src-elem)
at http://localhost:3197/src/entrypoints/viewer/main.tsx from being executed
because it violates the following directive: "script-src 'self'"
```

The dev manifest asks for `script-src 'self' 'wasm-unsafe-eval'
http://localhost:3197`. Firefox discards that and applies the default, because
a remote source is not allowed there. Chrome grants the same request. MV2 does
not help: its dev manifest carries the localhost origin too and Firefox refuses
it the same way. Nothing in the config changes this.

So `pnpm dev:firefox` builds the extension instead. `nodemon` rebuilds on every
change under `src`, and `web-ext run` reloads the add-on. Slower than Chrome's
hot reload, and it is a real build, which is the point. Chrome keeps WXT's dev
server.

**Reload the page after a change.** Reloading the add-on replaces the extension
Firefox holds, not the tabs already running the old one. A content script stays
injected from the previous version and an open viewer keeps the code it started
with, so the change appears only on the next page load. The terminal saying
`Last extension reload` means the new build is installed, not that you are
looking at it.

**The watch is pinned to `.output/.reload-stamp`**, a file the `dev:firefox`
script touches after each build, rather than to anything inside the output.
Watching the output directory reloads mid-build, since web-ext debounces for a
hard-coded 500ms and a build takes about twice that. Watching a file inside it
breaks after one rebuild, since `wxt build` recreates the directory and leaves
the watch on a dead inode.

**web-ext is driven by its own config**, `web-ext-config.mjs`, not by WXT.

**`firefoxProfile` must be an absolute path.** web-ext reads a relative value as
a profile *name*, passes `-P <name>`, and Firefox opens the profile manager. No
debugger port, so the run dies on ECONNREFUSED.

**`--new-instance --no-remote` are required.** An everyday Firefox is usually
running and would otherwise swallow the launch.

**Closing the browser ends the script.** `web-ext run` exits, and
`concurrently -k` stops the rebuild watcher with it. Without `-k` the watcher
keeps running and rebuilds on every change for a browser that is gone.

**Stopping the script does not close the browser.** Firefox keeps running.
Starting again then hits Firefox's own "already running" dialog, no debugger
port opens, and web-ext dies on ECONNREFUSED, which reads as a network fault
rather than a browser that is already open.

`pnpm dev:firefox` runs `scripts/free-firefox.mjs` first, which stops whatever
still holds this repository's dev profile and clears a stale lock. It matches on
the profile path, so an everyday Firefox is untouched.

## Testing

github.com answers 503 when it has had enough. Asking for the pull request page
proves nothing: the patch comes from `patch-diff.githubusercontent.com`, which
refuses on its own while github.com still answers 200. An empty viewer with a
503 toast is that, not a broken build.

`pnpm test:firefox` runs `.output/firefox-mv3` from `pnpm build:firefox` and
needs `DIFFSHUB_FIREFOX_PROFILE` pointing at a profile
signed in to github.com. Playwright cannot load an extension into Firefox, so
the suite drives web-ext's own RDP client
(`node_modules/web-ext/lib/firefox/remote.js`) to install a temporary add-on.

Playwright's bundled Firefox may refuse a profile it did not create. Use one it
made, signed in once.

Verify against a **private** pull request. A public one works with or without
the proxy and proves nothing.
