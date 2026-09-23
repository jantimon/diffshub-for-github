# Open items

Things worth doing, with enough detail to pick up cold. Not a backlog of
everything: each of these was found and set aside deliberately.

## Watch for a lost first click on the tab

Once seen: a click on the Files-changed tab the moment its marker appeared
opened nothing. It has not come back. Thirteen clicks made as soon as the
marker showed, eight after a full page load and five after reaching the pull
request from the list, all opened the viewer. The marker is drawn after the
page's `load` on a full load, and after GitHub's `pushState` on a client-side
visit, so there is no earlier moment to click in. `openViewer` in
`test/browser.mjs` still clicks again if nothing opened; a run that needs the
second click prints nothing today, so if it matters, make it say so.
