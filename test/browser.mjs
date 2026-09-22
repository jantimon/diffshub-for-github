/**
 * The parts every browser test repeats: launching Chromium with the extension
 * loaded, opening the overlay, and counting what passed.
 *
 * The profile is persistent so a logged-in session survives between runs, which
 * is the only way to reach a private pull request or write anything. That also
 * means it carries settings from the last run, so `openOverlay` clears them.
 */

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const dist = path.resolve(root, '../.output/chrome-mv3');

/** How long GitHub's own page needs before its tab strip is there to click */
const PAGE_SETTLE_MS = 3500;
/** How long the viewer needs to stream a patch and lay out the first files */
const VIEWER_SETTLE_MS = 12_000;

/**
 * Where a recorded run is kept, and which mode this run is in.
 *
 * `replay` serves github.com from the recording, so the suite is fast, works
 * offline, and cannot be throttled. `record` refreshes the recording against
 * the real thing. `live` ignores the recording altogether.
 *
 * Replay is the default, so a script written in a hurry cannot reach
 * github.com by forgetting to ask for the recording. Going live has to be
 * spelled out.
 *
 * The recording is made signed out, against a public pull request, so it
 * carries no cookie and nothing private. Anything needing a session has to run
 * live.
 */
const MODE = process.env.DIFFSHUB_HAR ?? 'replay';
const harFile = path.resolve(root, 'har', 'overlay.har');

export async function launch({ viewport = { width: 1600, height: 1000 }, har = false } = {}) {
  if (!fs.existsSync(dist)) {
    console.log(`No build at ${dist}. Run \`pnpm build\` first.`);
    process.exit(1);
  }

  // A recorded run must not carry a signed-in session into the recording, so it
  // gets a profile of its own that is thrown away afterwards
  const recording = har && MODE !== 'live';
  const profile = recording
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-har-'))
    : (process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'));

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    viewport,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  if (recording) {
    fs.mkdirSync(path.dirname(harFile), { recursive: true });
    await context.routeFromHAR(harFile, {
      url: '**/*github*/**',
      update: MODE === 'record',
      notFound: MODE === 'record' ? 'fallback' : 'abort',
    });
    console.log(`${MODE === 'record' ? 'recording' : 'replaying'} github.com traffic: ${harFile}`);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  const noise = [];
  page.on('pageerror', (error) => noise.push(`github: ${error.message.slice(0, 160)}`));
  return { context, page, noise };
}

/**
 * Opens the pull request, clicks the marked tab and waits for the viewer.
 *
 * Done twice: settings are held in the viewer's own localStorage, which cannot
 * be reached until it has been opened once, and clearing them has to happen
 * before the run's first assertion or the last run's filters are still on.
 */
export async function openOverlay(page, url, { noise } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(PAGE_SETTLE_MS);
  await page.locator('[data-diffshub-marked]').first().click();
  await page.waitForTimeout(VIEWER_SETTLE_MS);

  let frame = viewerFrame(page);
  if (frame == null) return undefined;

  await frame.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
    }
  });

  await page.reload();
  await page.waitForTimeout(PAGE_SETTLE_MS);
  await page.locator('[data-diffshub-marked]').first().click();
  await page.waitForTimeout(VIEWER_SETTLE_MS);

  // Console events are emitted by the page, never by a frame, so this listens
  // there and keeps only what came from the viewer
  if (noise != null) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const from = message.location().url;
      if (from.startsWith('chrome-extension://')) noise.push(`viewer: ${message.text().slice(0, 160)}`);
    });
  }
  return viewerFrame(page);
}

/**
 * Takes the credentials back out of a fresh recording.
 *
 * Recording runs signed out, but github.com still hands an anonymous session to
 * anyone who asks, so the file would otherwise carry `Cookie` and `Set-Cookie`
 * for every request. It is gitignored as well. This is so the bytes are
 * harmless even when the file is copied somewhere else.
 */
export function stripCredentials(file = harFile) {
  if (!fs.existsSync(file)) return 0;

  const har = JSON.parse(fs.readFileSync(file, 'utf8'));
  let removed = 0;
  for (const entry of har.log.entries) {
    for (const side of [entry.request, entry.response]) {
      const before = side.headers.length;
      side.headers = side.headers.filter(
        (header) => !['cookie', 'set-cookie', 'authorization'].includes(header.name.toLowerCase()),
      );
      removed += before - side.headers.length;
      side.cookies = [];
    }
  }
  fs.writeFileSync(file, JSON.stringify(har));
  return removed;
}

export function viewerFrame(page) {
  return page.frames().find((f) => f.url().startsWith('chrome-extension://'));
}

/**
 * Screenshots of each step, kept out of git, so a run can be looked over after
 * it finishes rather than only watched
 */
export function screenshots(page) {
  const dir = path.resolve(root, 'screenshots');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let index = 0;
  return {
    dir,
    shoot: (name) =>
      page.screenshot({ path: path.join(dir, `${String(++index).padStart(2, '0')}-${name}.png`) }),
  };
}

/**
 * Runs one assertion and remembers whether it held.
 *
 * A check that throws counts as a failure rather than stopping the run, so one
 * broken selector does not hide everything after it.
 */
export function checker() {
  let failures = 0;

  const check = async (name, fn) => {
    try {
      const value = await fn();
      if (value) {
        console.log(`ok    ${name}${value !== true ? ` — ${value}` : ''}`);
        return true;
      }
      failures += 1;
      console.log(`FAIL  ${name}`);
      return false;
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`);
      return false;
    }
  };

  /** Prints the tally and leaves with a status that says whether it passed */
  const finish = async (context, noise = []) => {
    if (noise.length > 0) console.log('\nconsole noise:\n' + [...new Set(noise)].slice(0, 8).join('\n'));
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
    // Playwright writes the recording as the context closes, so it can only be
    // cleaned afterwards
    await context.close();
    if (MODE === 'record') {
      console.log(`recording cleaned: ${stripCredentials()} credential header(s) removed`);
    }
    process.exit(failures === 0 ? 0 : 1);
  };

  return { check, finish, failed: () => failures };
}
