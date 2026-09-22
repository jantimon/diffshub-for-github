# Firefox

What differs from Chrome, and the traps. Each item cost real time to find.

## Runtime

**Total Cookie Protection partitions the viewer's cookies.** The viewer is an
extension iframe inside a github.com page, so its cookie jar is keyed by the
top-level site and every github.com request from it leaves signed out. A
private patch gets 404 there and 200 through the background script.
`src/viewer/files/githubFetch.ts` proxies through the background on Firefox
only, streamed in chunks so rendering stays progressive.

**Do not remove that proxy because a test says it is unneeded.** A profile with
`network.cookie.cookieBehavior` at 4 has the feature off. Firefox defaults to 5.
Playwright's own profile ships 4, which once made the proxy look pointless and
it was deleted. `test/firefox.mjs` now pins the real default.

**Background is an event page**, `scripts: [background.js]`, not a service
worker. AMO needs the add-on id and `data_collection_permissions` in
`wxt.config.ts`.

**Host access can be revoked after install.** `src/entrypoints/background.ts`
watches `browser.permissions` and marks the toolbar button when it goes.

## Development

**Local Network Access blocks the dev server.** Firefox gates a secure context
reaching this machine and answers with an automatic denial, so every module and
the reload socket are refused and the overlay never starts. The console shows a
failed WebSocket; the cause is `Loading failed for the module` above it.
`web-ext.config.ts` sets `network.lna.enabled`, `network.lna.blocking` and
`permissions.default.local-network`. Blocking alone was not enough.

**Content scripts are registered over the dev socket**, not declared in the dev
manifest. No socket means nothing injects: no tab marker, and the toolbar button
has nobody to message. The extension looks dead rather than broken.

**The dev server must bind IPv4.** Left alone it binds `::1`; Firefox resolves
`ws://localhost:3197` to 127.0.0.1. `wxt.config.ts` sets `dev.server.host`.

**`firefoxProfile` must be an absolute path.** web-ext reads a relative value as
a profile *name*, passes `-P <name>`, and Firefox opens the profile manager. No
debugger port, so the run dies on ECONNREFUSED.

**`--new-instance --no-remote` are required.** An everyday Firefox is usually
running and would otherwise swallow the launch.

**Closing the browser kills `pnpm dev:firefox`.** web-ext ends the run when it
loses the debugger connection, with ECONNREFUSED and exit 1. Expected, not a
bug.

**Killing the dev server does not close the browser.** `pkill` on the wxt
process leaves Firefox running. Starting again then hits Firefox's own "already
running" dialog, no debugger port opens, and web-ext dies on ECONNREFUSED, which
reads as a network fault rather than a browser that is already open.

`pnpm dev:firefox` runs `scripts/free-firefox.mjs` first, which stops whatever
still holds this repository's dev profile and clears a stale lock. It matches on
the profile path, so an everyday Firefox is untouched.

## Testing

github.com answers 503 when it has had enough. Asking for the pull request page
proves nothing: the patch comes from `patch-diff.githubusercontent.com`, which
refuses on its own while github.com still answers 200. An empty viewer with a
503 toast is that, not a broken build.

`pnpm test:firefox` needs `DIFFSHUB_FIREFOX_PROFILE` pointing at a profile
signed in to github.com. Playwright cannot load an extension into Firefox, so
the suite drives web-ext's own RDP client
(`node_modules/web-ext/lib/firefox/remote.js`) to install a temporary add-on.

Playwright's bundled Firefox may refuse a profile it did not create. Use one it
made, signed in once.

Verify against a **private** pull request. A public one works with or without
the proxy and proves nothing.
