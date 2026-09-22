/**
 * How Firefox is launched for `pnpm dev:firefox`.
 *
 * This is the `web-ext` CLI's own config file, not WXT's. Firefox refuses to
 * run an extension page's scripts from a dev server, whatever the manifest
 * says, so WXT's Firefox dev mode cannot render the viewer at all and the
 * script drives `web-ext run` over a real build instead. Chrome keeps WXT.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const profile = resolve(import.meta.dirname, '.firefox-profile');

// web-ext only treats this as a path if the directory is already there, and
// reads it as a profile name otherwise, which fails. Firefox fills an empty
// directory in on first run
mkdirSync(profile, { recursive: true });

export default {
  run: {
    /**
     * Absolute, deliberately: web-ext reads a relative value as a profile *name*
     * and passes `-P <name>`, which drops Firefox into the profile manager, so no
     * debugger port ever opens and the run dies on ECONNREFUSED
     */
    firefoxProfile: profile,
    /** Keep the profile between runs so a GitHub login survives a restart */
    keepProfileChanges: true,
    startUrl: ['https://github.com/nodejs/node/pull/60000'],
    /**
     * An everyday Firefox is usually already running. Without these the launch is
     * handed to that instance and the new process exits immediately
     */
    args: ['--new-instance', '--no-remote'],
    /** Streams the Browser Console to this terminal */
    browserConsole: true,
    /**
     * One stamp file, touched by the build script once a build has finished.
     *
     * Watching the output directory instead reloads the add-on halfway through
     * a rebuild: web-ext debounces for a hard-coded 500ms and a build takes
     * about twice that, so it fires on a half-written extension.
     *
     * Watching a file inside the output fails the other way, because `wxt
     * build` recreates that directory and the watch is left holding a dead
     * inode. The stamp sits beside it, outlives every build, and changes last
     */
    watchFile: [resolve(import.meta.dirname, '.output/.reload-stamp')],
    /**
     * `name=value` strings rather than an object: web-ext validates config keys
     * as camel case, and a dotted preference name fails that check.
     *
     * `devtools.debugger.remote-enabled` is deliberately absent. web-ext owns
     * that one and refuses to have it set from here
     */
    pref: [
      'devtools.chrome.enabled=true',
      'browser.aboutwelcome.enabled=false',
      // Mirror extension console output onto Firefox's stdout
      'devtools.console.stdout.chrome=true',
      'devtools.console.stdout.content=true',
    ],
  },
};
