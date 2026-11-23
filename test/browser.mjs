/**
 * The parts every browser test repeats: launching Chromium with the extension
 * loaded, opening the overlay, and counting what passed.
 *
 * The profile is persistent so a logged-in session survives between runs, which
 * is the only way to reach a private pull request or write anything. That also
 * means it carries settings from the last run, so `openOverlay` clears them.
 */

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
 * The recordings are made signed out, against public pull requests, and are
 * committed so CI can replay them. They carry no cookie and nothing private.
 * Anything needing a session has to run live.
 */
export const MODE = process.env.DIFFSHUB_HAR ?? 'replay';

/**
 * Each suite keeps its recording in one zip, `test/har/<name>.zip`: the HAR
 * names the requests, and every response body sits beside it, named by its
 * hash. Playwright replays the zip as it is. One binary file per suite keeps
 * thousands of lines of GitHub's own scripts out of every diff that refreshes
 * a recording
 */
export const harPath = (name) => path.resolve(root, 'har', `${name}.zip`);

/**
 * The recording this run serves or writes. A new recording goes to a folder
 * of its own and only replaces the zip once the run has finished without
 * being refused, so a run cut short by throttling leaves the good one alone.
 */
let harFile = harPath('overlay');
let partialFile = partialFor(harFile);

function partialFor(file) {
  return path.join(file.replace(/\.zip$/, '.partial'), 'recording.har');
}

function discardPartial() {
  fs.rmSync(path.dirname(partialFile), { recursive: true, force: true });
}

/** Packs the finished folder into the suite's zip, the HAR and its bodies side by side */
function packPartial() {
  const packed = `${harFile}.new`;
  fs.rmSync(packed, { force: true });
  // -X leaves out the file owners and extra timestamps, so the zip only
  // changes when the recording does
  execFileSync('zip', ['-q', '-X', '-r', '-D', packed, '.'], { cwd: path.dirname(partialFile) });
  fs.renameSync(packed, harFile);
  discardPartial();
}

/** How long to wait between the steps of a recording, so it asks gently */
const RECORDING_PACE_MS = Number(process.env.DIFFSHUB_PACE_MS ?? 4000);

/**
 * What github.com says when it has had enough. The throttling is on the
 * session rather than the address, and it arrives as a plain status rather
 * than anything that reads like an explanation.
 */
const REFUSED = new Set([429, 502, 503, 504]);

/**
 * A header on answers a check makes up itself, such as the 503 that proves the
 * retry, so the recorder does not take them for github.com refusing
 */
export const INJECTED = 'x-diffshub-injected';

export async function launch({
  viewport = { width: 1600, height: 1000 },
  deviceScaleFactor,
  har = false,
  headed = process.env.DIFFSHUB_HEADED === '1',
} = {}) {
  if (!fs.existsSync(dist)) {
    console.log(`No build at ${dist}. Run \`pnpm build\` first.`);
    process.exit(1);
  }

  if (har) requireRecording('overlay');

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
    /**
     * Without a window by default, so a run does not take over the screen.
     * This is Chrome's own headless mode, the full browser with extensions,
     * not a separate shell. `DIFFSHUB_HEADED=1` shows it, to watch a run
     */
    headless: !headed,
    viewport,
    deviceScaleFactor,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  if (usesHar) await routeFromRecording(context, 'overlay');

  const page = context.pages()[0] ?? (await context.newPage());
  const noise = [];
  page.on('pageerror', (error) => noise.push(`github: ${error.message.slice(0, 160)}`));
  if (usesHar) stopOnRefusal(context, page);

  return { context, page, noise };
}

/** Replaying needs the recording. Without one every request would abort */
export function requireRecording(name) {
  const file = harPath(name);
  if (MODE !== 'replay' || fs.existsSync(file)) return;
  console.log(`No recording at ${path.relative(process.cwd(), file)}.`);
  console.log('');
  console.log('The suite replays github.com from a recording kept in test/har.');
  console.log('It is taken signed out, from a public pull request, with credentials stripped.');
  console.log('');
  console.log('  pnpm build && pnpm test:record   make the recording, then `pnpm test` runs offline');
  console.log('  pnpm build && pnpm test:live     or run the same checks against github.com');
  process.exit(1);
}

/**
 * Serves github.com from `test/har/<name>.zip`, or writes it when recording.
 * Every host with "github" in it, so the patch host and the avatars come from
 * the recording too
 */
export async function routeFromRecording(context, name) {
  harFile = harPath(name);
  partialFile = partialFor(harFile);
  if (MODE === 'record') {
    discardPartial();
    fs.mkdirSync(path.dirname(partialFile), { recursive: true });
  }
  const target = MODE === 'record' ? partialFile : harFile;
  await context.routeFromHAR(target, {
    url: '**/*github*/**',
    update: MODE === 'record',
    updateContent: 'attach',
    notFound: MODE === 'record' ? 'fallback' : 'abort',
  });
  console.log(`${MODE === 'record' ? 'recording' : 'replaying'} github.com traffic: ${target}`);
}

/**
 * A recording made while github.com is refusing requests is worse than none:
 * it would replay the refusals as if they were the answers
 */
export function stopOnRefusal(context, page) {
  if (MODE !== 'record') return;
  page.on('response', (response) => {
    if (!REFUSED.has(response.status())) return;
    if (!/github/.test(new URL(response.url()).host)) return;
    if (response.headers()[INJECTED] != null) return;

    console.log(`\ngithub.com answered ${response.status()} for ${response.url().slice(0, 90)}`);
    console.log('stopping: a recording of refusals is worse than no recording');
    discardPartial();
    void context.close().finally(() => process.exit(2));
  });
}

/**
 * A recording is committed, so it must come from a signed-out browser. GitHub
 * names the signed-in reader in a meta tag on every page. Finding one there
 * stops the run before anything is written
 */
export async function refuseSignedInRecording(context, page) {
  if (MODE !== 'record') return;
  const login = await page.evaluate(
    () => document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? '',
  );
  if (login === '') return;
  console.log(`\nthis browser is signed in to github.com as ${login}`);
  console.log('stopping: a committed recording must be made signed out');
  discardPartial();
  await context.close();
  process.exit(2);
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
  const before = page.url();
  for (let attempt = 0; attempt < 3 && frame == null; attempt += 1) {
    await clickMarker(page);
    frame = await until(() => viewerFrame(page), { timeout: 3000 });
    // A click beside the icon goes to GitHub's own view, and every check after
    // it would fail against the wrong page. Saying so names the real cause
    if (page.url() !== before) throw new Error(`the click missed the icon and went to ${page.url()}`);
  }
  await frame
    ?.locator('.dh-overlay[data-dh-phase="ready"], .dh-overlay[data-dh-phase="error"]')
    .waitFor({ timeout: VIEWER_READY_MS });
  await page.waitForTimeout(LAYOUT_SETTLE_MS + pace);
  return viewerFrame(page);
}

/**
 * Clicks the extension's icon on the Files-changed tab, which is what opens the
 * viewer: a click on the rest of the tab goes to GitHub's own view. The icon
 * is the last thing in the link, 14 px wide, ending where its right padding
 * starts, so the click lands in its middle
 */
export async function clickMarker(page) {
  const tab = page.locator('[data-diffshub-marked]').first();
  const iconCentre = () =>
    tab.evaluate((link) => {
      const box = link.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(link).paddingRight);
      return { x: box.right - padding - 7, y: box.top + box.height / 2 };
    });
  // GitHub lays the tab strip out again for a moment after `load`, which moves
  // the tab by some 75 px, so the point is taken once it has held still for
  // three readings in a row
  let last;
  let still = 0;
  const point = await until(
    async () => {
      const now = await iconCentre();
      still = last != null && now.x === last.x && now.y === last.y ? still + 1 : 0;
      last = now;
      return still >= 2 && now;
    },
    { timeout: 5000, every: 200 },
  );
  await page.mouse.click((point ?? last).x, (point ?? last).y);
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
  await refuseToRecordWhileRefused(url);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await refuseSignedInRecording(page.context(), page);
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
 * for every request. The file is committed, so the bytes must be harmless.
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
 * Takes out the answers a check made up itself. Playwright records a fulfilled
 * route like any other answer, so the 503 that proves the retry would
 * otherwise replay as GitHub's answer for the patch every time
 */
export function dropInjected(file = harFile) {
  if (!fs.existsSync(file)) return 0;

  const har = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = har.log.entries.length;
  har.log.entries = har.log.entries.filter(
    (entry) => !entry.response.headers.some((header) => header.name.toLowerCase() === INJECTED),
  );
  fs.writeFileSync(file, JSON.stringify(har));
  return before - har.log.entries.length;
}

/**
 * Stops a recording before it starts if github.com is turning requests away.
 *
 * The patch is the one request the whole suite rests on, and it comes from a
 * host of its own that can refuse while github.com itself answers, so asking
 * for the page proves nothing. One request, before a browser is launched.
 */
export async function refuseToRecordWhileRefused(url) {
  if (MODE !== 'record') return;
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
        discardPartial();
      } else {
        console.log(`recording cleaned: ${stripCredentials(partialFile)} credential header(s) removed`);
        console.log(`recording cleaned: ${dropInjected(partialFile)} made-up answer(s) removed`);
        packPartial();
        console.log(`recording replaced: ${path.relative(process.cwd(), harFile)}`);
      }
    }
    process.exit(failures === 0 ? 0 : 1);
  };

  return { check, finish, failed: () => failures };
}
