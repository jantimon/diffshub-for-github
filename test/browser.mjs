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
import path from 'node:path';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const dist = path.resolve(root, '../.output/chrome-mv3');

/** How long GitHub's own page needs before its tab strip is there to click. */
const PAGE_SETTLE_MS = 3500;
/** How long the viewer needs to stream a patch and lay out the first files. */
const VIEWER_SETTLE_MS = 12_000;

export async function launch({ viewport = { width: 1600, height: 1000 } } = {}) {
  if (!fs.existsSync(dist)) {
    console.log(`No build at ${dist}. Run \`pnpm build\` first.`);
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(
    process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
    {
      channel: 'chromium',
      headless: false,
      viewport,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    }
  );

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

  frame = viewerFrame(page);
  if (frame != null && noise != null) {
    frame.on('console', (m) => {
      if (m.type() === 'error') noise.push(`viewer: ${m.text().slice(0, 160)}`);
    });
  }
  return frame;
}

export function viewerFrame(page) {
  return page.frames().find((f) => f.url().startsWith('chrome-extension://'));
}

/**
 * Screenshots of each step, kept out of git, so a run can be looked over after
 * it finishes rather than only watched.
 */
export function screenshots(page) {
  const dir = path.resolve(root, 'screenshots');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let index = 0;
  return {
    dir,
    shoot: (name) => page.screenshot({ path: path.join(dir, `${String(++index).padStart(2, '0')}-${name}.png`) }),
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

  /** Prints the tally and leaves with a status that says whether it passed. */
  const finish = async (context, noise = []) => {
    if (noise.length > 0) console.log('\nconsole noise:\n' + [...new Set(noise)].slice(0, 8).join('\n'));
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
    await context.close();
    process.exit(failures === 0 ? 0 : 1);
  };

  return { check, finish, failed: () => failures };
}
