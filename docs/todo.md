# Open items

Things worth doing, with enough detail to pick up cold. Not a backlog of
everything: each of these was found and set aside deliberately.

## Say when the tab needed a second click

`openViewer` in `test/browser.mjs` clicks the Files-changed tab up to three
times and prints nothing when the first click opened nothing. A run that needs
the second click looks like a run that did not, so a lost first click would
never show up. Make it say so.
