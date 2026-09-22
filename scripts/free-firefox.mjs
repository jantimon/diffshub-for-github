/**
 * Clears whatever would stop `wxt -b firefox` from launching.
 *
 * Firefox refuses to start a second time on a profile that another process
 * already holds, and says so in a dialog. No debugger port opens, so web-ext
 * cannot attach and the run dies on ECONNREFUSED, which reads as a network
 * fault rather than a browser that is already open.
 *
 * Only processes holding this repository's own dev profile are stopped. An
 * everyday Firefox uses a different profile and is left alone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = resolve(dirname(fileURLToPath(import.meta.url)), '../.firefox-profile');

function holdingTheProfile() {
  let listing;
  try {
    listing = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return listing
    .split('\n')
    .filter((line) => line.includes(profile))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

const running = holdingTheProfile();
for (const pid of running) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone between listing it and asking it to stop
  }
}

if (running.length > 0) {
  console.log(`closed ${running.length} Firefox process(es) still holding the dev profile`);
  // Firefox writes the lock on the way out, so wait for it to finish
  const until = Date.now() + 5000;
  while (holdingTheProfile().length > 0 && Date.now() < until) {
    execFileSync('sleep', ['0.2']);
  }
}

// A profile left locked by a process that did not exit cleanly blocks the next
// launch the same way a running one does
const lock = resolve(profile, '.parentlock');
if (existsSync(lock)) {
  rmSync(lock, { force: true });
  console.log('removed a stale profile lock');
}
