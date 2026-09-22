import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

const profile = resolve(import.meta.dirname, '.firefox-profile');

// web-ext only treats this as a path if the directory is already there, and
// reads it as a profile name otherwise, which fails. Firefox fills an empty
// directory in on first run
mkdirSync(profile, { recursive: true });

/**
 * `pnpm dev:firefox` drives a real Firefox through web-ext, which installs the
 * build as a temporary add-on over the remote debugging protocol
 */
export default defineWebExtConfig({
  /**
   * Absolute, deliberately: web-ext reads a relative value as a profile *name*
   * and passes `-P <name>`, which drops Firefox into the profile manager, so no
   * debugger port ever opens and the run dies on ECONNREFUSED
   */
  firefoxProfile: profile,
  /** Keep the profile between runs so a GitHub login survives a restart */
  keepProfileChanges: true,
  startUrls: ['https://github.com/nodejs/node/pull/60000'],
  /**
   * An everyday Firefox is usually already running. Without these the launch is
   * handed to that instance and the new process exits immediately
   */
  firefoxArgs: ['--new-instance', '--no-remote'],
  /** Streams the Browser Console to this terminal */
  openConsole: true,
  firefoxPref: {
    'devtools.chrome.enabled': true,
    'devtools.debugger.remote-enabled': true,
    'browser.aboutwelcome.enabled': false,
    /** Mirror extension console output onto Firefox's stdout */
    'devtools.console.stdout.chrome': true,
    'devtools.console.stdout.content': true,

    /**
     * Local Network Access gates a request from a secure context to an address
     * on this machine, and answers it with an automatic denial.
     *
     * In development the viewer is an extension page inside a github.com tab
     * loading its modules from the dev server on localhost, which is exactly
     * that shape, so every module and the reload socket are refused and the
     * overlay never starts.
     *
     * Turning blocking off alone was not enough, so all three are set
     * together: the feature switch, the blocking switch and the permission
     * itself. Only the throwaway dev profile is affected. A built extension
     * talks to github.com and nothing on this machine.
     */
    'network.lna.enabled': false,
    'network.lna.blocking': false,
    'permissions.default.local-network': 1,
  },
});
