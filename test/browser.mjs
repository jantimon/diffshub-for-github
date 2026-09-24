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

/** Longest the viewer may take to read the whole patch before a test gives up on it */
const VIEWER_READY_MS = 60_000;

/** Enough for the viewer to lay out the first files once the patch is in */
const LAYOUT_SETTLE_MS = 600;

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

/**
 * A recording is written beside the good one and only takes its place once the
 * run has finished without being refused. A run cut short by throttling would
 * otherwise leave a half-written file where a working recording used to be.
 */
const partialFile = `${harFile}.partial`;

/** How long to wait between the steps of a recording, so it asks gently */
const RECORDING_PACE_MS = Number(process.env.DIFFSHUB_PACE_MS ?? 4000);

/**
 * What github.com says when it has had enough. The throttling is on the
 * session rather than the address, and it arrives as a plain status rather
 * than anything that reads like an explanation.
 */
const REFUSED = new Set([429, 502, 503, 504]);

export async function launch({
  viewport = { width: 1600, height: 1000 },
  deviceScaleFactor,
  har = false,
} = {}) {
  if (!fs.existsSync(dist)) {
    console.log(`No build at ${dist}. Run \`pnpm build\` first.`);
    process.exit(1);
  }

  // The recording is made on each machine rather than kept in git, so a fresh
  // clone has none, and replaying nothing would abort every request
  if (har && MODE === 'replay' && !fs.existsSync(harFile)) {
    console.log(`No recording at ${path.relative(process.cwd(), harFile)}.`);
    console.log('');
    console.log('The suite replays github.com from a recording you make once, on this machine.');
    console.log('It is taken signed out, from a public pull request, with credentials stripped.');
    console.log('');
    console.log('  pnpm build && pnpm test:record   make the recording, then `pnpm test` runs offline');
    console.log('  pnpm build && pnpm test:live     or run the same checks against github.com');
    process.exit(1);
  }

  // Replaying or recording, the run serves or writes the HAR. A recording must
  // not carry a signed-in session into it, so both get a profile of their own
  // that is thrown away afterwards
  const usesHar = har && MODE !== 'live';
  const profile = usesHar
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-har-'))
    : (process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'));

  // Chrome keeps each service worker's script in the profile, and can start
  // that copy of an unpacked extension's background instead of the new build,
  // so a kept profile would test an old background. The copy goes first
  if (!usesHar) fs.rmSync(path.join(profile, 'Default', 'Service Worker'), { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    /** Headed by default, so a run can be watched. `DIFFSHUB_HEADLESS=1` for a machine without a screen */
    headless: process.env.DIFFSHUB_HEADLESS === '1',
    viewport,
    deviceScaleFactor,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  if (usesHar) {
    fs.mkdirSync(path.dirname(harFile), { recursive: true });
    const target = MODE === 'record' ? partialFile : harFile;
    await context.routeFromHAR(target, {
      url: '**/*github*/**',
      update: MODE === 'record',
      notFound: MODE === 'record' ? 'fallback' : 'abort',
    });
    console.log(`${MODE === 'record' ? 'recording' : 'replaying'} github.com traffic: ${target}`);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  const noise = [];
  page.on('pageerror', (error) => noise.push(`github: ${error.message.slice(0, 160)}`));

  // A recording made while github.com is refusing requests is worse than none:
  // it would replay the refusals as if they were the answers
  if (MODE === 'record') {
    page.on('response', (response) => {
      if (!REFUSED.has(response.status())) return;
      if (!/github/.test(new URL(response.url()).host)) return;

      console.log(`\ngithub.com answered ${response.status()} for ${response.url().slice(0, 90)}`);
      console.log('stopping: a recording of refusals is worse than no recording');
      fs.rmSync(partialFile, { force: true });
      void context.close().finally(() => process.exit(2));
    });
  }

  return { context, page, noise };
}

/**
 * Waits until the page's Files-changed tab carries the extension's marker, then
 * clicks it and waits for the viewer to have the whole patch.
 *
 * Waiting on what the page and the viewer say, rather than for a fixed time,
 * is what keeps a run quick on a fast machine and correct on a slow one. The
 * viewer puts its load phase on `.dh-overlay` as `data-dh-phase`.
 */
export async function openViewer(page, { pace = 0 } = {}) {
  const tab = page.locator('[data-diffshub-marked]').first();
  await tab.waitFor({ timeout: 30_000 });
  // The page's load comes first, and a click that opened nothing is made
  // again, so one lost click does not fail a run. `docs/todo.md` asks for the
  // retry to say so
  await page.waitForLoadState('load');
  if (pace > 0) await page.waitForTimeout(pace);
  let frame;
  for (let attempt = 0; attempt < 3 && frame == null; attempt += 1) {
    await tab.click();
    frame = await until(() => viewerFrame(page), { timeout: 3000 });
  }
  await frame
    ?.locator('.dh-overlay[data-dh-phase="ready"], .dh-overlay[data-dh-phase="error"]')
    .waitFor({ timeout: VIEWER_READY_MS });
  await page.waitForTimeout(LAYOUT_SETTLE_MS + pace);
  return viewerFrame(page);
}

/** Removes the viewer's remembered settings: filters, layout, ticks, the lot */
export async function clearSettings(frame) {
  await frame.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
    }
  });
}

/**
 * Polls until `probe` answers something other than nothing or `false`, and
 * answers that, or `undefined` once `timeout` has passed. For waiting on a
 * state the page reaches, instead of sleeping for a guess of how long it takes.
 */
export async function until(probe, { timeout = 10_000, every = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value != null && value !== false) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

/**
 * Waits until the diff pane has stopped scrolling: the same `scrollTop` on
 * three reads in a row. Jumping to a file scrolls smoothly and then the rows
 * that came into view are measured, so the position moves for a while.
 */
export async function scrollSettled(frame, { timeout = 5000 } = {}) {
  const pane = frame.locator('.dh-code');
  let last;
  let same = 0;
  return until(
    async () => {
      const top = await pane.evaluate((node) => node.scrollTop);
      same = top === last ? same + 1 : 0;
      last = top;
      return same >= 2;
    },
    { timeout, every: 80 },
  );
}

/**
 * Opens the pull request, clicks the marked tab and waits for the viewer.
 *
 * Done twice: settings are held in the viewer's own localStorage, which cannot
 * be reached until it has been opened once, and clearing them has to happen
 * before the run's first assertion or the last run's filters are still on.
 */
export async function openOverlay(page, url, { noise } = {}) {
  // Recording asks github.com for everything on the page, so it goes slowly
  // A burst is what gets a session throttled, and a throttled recording is a
  // recording of refusals
  const pace = MODE === 'record' ? RECORDING_PACE_MS : 0;
  if (MODE === 'record') await refuseToRecordWhileRefused(url);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const first = await openViewer(page, { pace });
  if (first == null) return undefined;
  await clearSettings(first);

  await page.reload();
  const frame = await openViewer(page, { pace });

  // Console events are emitted by the page, never by a frame, so this listens
  // there and keeps only what came from the viewer
  if (noise != null) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const from = message.location().url;
      if (from.startsWith('chrome-extension://')) noise.push(`viewer: ${message.text().slice(0, 160)}`);
    });
  }
  return frame;
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

/**
 * Stops a recording before it starts if github.com is turning requests away.
 *
 * The patch is the one request the whole suite rests on, and it comes from a
 * host of its own that can refuse while github.com itself answers, so asking
 * for the page proves nothing. One request, before a browser is launched.
 */
async function refuseToRecordWhileRefused(url) {
  const patch = `${url.replace(/\/+$/, '')}.diff`;
  let status;
  try {
    status = (await fetch(patch, { redirect: 'follow' })).status;
  } catch (error) {
    console.log(`could not reach ${patch}: ${String(error).slice(0, 80)}`);
    process.exit(2);
  }

  if (REFUSED.has(status)) {
    console.log(`github.com answered ${status} for the patch, so there is nothing worth recording`);
    console.log('the previous recording is untouched; try again later');
    process.exit(2);
  }
  console.log(`patch answered ${status}, recording`);
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
      if (failures > 0) {
        console.log('kept the previous recording: this run had failures');
        fs.rmSync(partialFile, { force: true });
      } else {
        console.log(`recording cleaned: ${stripCredentials(partialFile)} credential header(s) removed`);
        fs.renameSync(partialFile, harFile);
        console.log(`recording replaced: ${harFile}`);
      }
    }
    process.exit(failures === 0 ? 0 : 1);
  };

  return { check, finish, failed: () => failures };
}
