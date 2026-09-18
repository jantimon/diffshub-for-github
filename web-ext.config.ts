import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

// `pnpm dev:firefox` drives a real Firefox through web-ext, which installs the
// build as a temporary add-on over the remote debugging protocol.
export default defineWebExtConfig({
  // Absolute, deliberately: web-ext reads a relative value as a profile *name*
  // and passes `-P <name>`, which drops Firefox into the profile manager, so no
  // debugger port ever opens and the run dies on ECONNREFUSED.
  firefoxProfile: resolve(import.meta.dirname, '.firefox-profile'),
  // Keep the profile between runs so a GitHub login survives a restart.
  keepProfileChanges: true,
  startUrls: ['https://github.com/nodejs/node/pull/60000'],
  // An everyday Firefox is usually already running; without these the launch is
  // handed to that instance and the new process exits immediately.
  firefoxArgs: ['--new-instance', '--no-remote'],
  // Streams the Browser Console to this terminal.
  openConsole: true,
  firefoxPref: {
    'devtools.chrome.enabled': true,
    'devtools.debugger.remote-enabled': true,
    'browser.aboutwelcome.enabled': false,
    // Mirror extension console output onto Firefox's stdout.
    'devtools.console.stdout.chrome': true,
    'devtools.console.stdout.content': true,
  },
});
