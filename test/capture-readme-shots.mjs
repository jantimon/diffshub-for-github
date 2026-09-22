import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Presentation screenshots for the README. Unlike run-spike.mjs these are kept
// in git, so they go to docs/images and are shot at a large viewport
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const images = path.resolve(root, '../docs/images');

const PULL_REQUEST = process.argv[2] ?? 'https://github.com/nodejs/node/pull/59805';
const FALLBACK = 'https://github.com/nodejs/node/pull/60000';

fs.mkdirSync(images, { recursive: true });

const context = await chromium.launchPersistentContext(
  process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
  {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  },
);

const page = context.pages()[0] ?? (await context.newPage());
const shoot = async (name, options) => {
  await page.screenshot({ path: path.join(images, `${name}.png`), ...options });
  console.log(`  wrote docs/images/${name}.png`);
};

/** GitHub's own attributes are what the content script reads when it opens */
const setColorMode = (mode) =>
  page.evaluate((value) => {
    const html = document.documentElement;
    html.dataset.colorMode = value;
    html.dataset.lightTheme = 'light';
    html.dataset.darkTheme = 'dark';
  }, mode);

const loadPullRequest = async (url) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('[data-diffshub-marked]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    return true;
  } catch {
    return false;
  }
};

const viewerFrame = () => page.frames().find((f) => f.url().startsWith('chrome-extension://'));

/** Shiki writes a styled span per token, so these count the highlighting */
const tokenCount = (frame) =>
  frame
    .locator('span[style]')
    .count()
    .catch(() => 0);

/**
 * Waits until the diff is really on screen: the patch read to the end and code
 * lines rendered. A half-drawn screenshot is worse than none. The viewer puts
 * every file in its own shadow root, so this counts through Playwright
 * locators, which reach into them, rather than `document.querySelectorAll`,
 * which does not.
 */
const waitForRenderedDiff = async () => {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const frame = viewerFrame();
    if (frame != null) {
      const lines = await frame
        .locator('[data-line]')
        .count()
        .catch(() => 0);
      const loading = await frame
        .locator('.dh-loading')
        .count()
        .catch(() => 1);
      if (loading === 0 && lines > 50) {
        await page.waitForTimeout(4000);
        return frame;
      }
      console.log(`  waiting — ${lines} lines, loading=${loading}`);
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('the diff never finished rendering');
};

/**
 * The first files of a large pull request are often dotfiles and build config,
 * which have almost nothing to colour. Scroll the diff until real source code
 * is on screen, so the shot shows the viewer doing its job.
 */
const findHighlightedCode = async (frame) => {
  await page.mouse.move(1100, 600);
  // Past the dotfiles and build config at the top, quickly
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(400);
  }
  // Then on, a screen at a time. Highlighting runs in a worker and lands after
  // the lines do, so give each position time to colour before scrolling past
  for (let step = 0; step < 30; step += 1) {
    for (let settle = 0; settle < 6; settle += 1) {
      if ((await tokenCount(frame)) > 400) {
        await page.waitForTimeout(3000);
        console.log(`  scrolled ${24 + step} turns to reach highlighted code`);
        return;
      }
      await page.waitForTimeout(1000);
    }
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(500);
  }
  throw new Error('never reached a file with syntax highlighting');
};

const openOverlay = async (mode) => {
  await setColorMode(mode);
  await page.waitForTimeout(400);
  await page.locator('[data-diffshub-marked]').first().click();
  const frame = await waitForRenderedDiff();
  await findHighlightedCode(frame);
  return frame;
};

let url = PULL_REQUEST;
if (!(await loadPullRequest(url))) {
  console.log(`${url} did not load — falling back to ${FALLBACK}`);
  url = FALLBACK;
  if (!(await loadPullRequest(url))) throw new Error('neither pull request loaded');
}
console.log(`capturing ${url}`);

// 1. The entry point: the marked "Files changed" tab, cropped so the badge reads.
await setColorMode('dark');
await page.waitForTimeout(600);
const tab = await page.locator('[data-diffshub-marked]').first();
const box = await tab.boundingBox();
// Crop from the start of the tab strip, so no neighbouring tab is cut in half
const strip = await tab.evaluate((el) => {
  const nav = el.closest('nav, ul') ?? el.parentElement;
  const rect = nav.getBoundingClientRect();
  return { x: rect.x, y: rect.y, height: rect.height };
});
const left = Math.max(0, Math.min(strip.x, box.x - 460) - 16);
await shoot('files-changed-tab', {
  clip: {
    x: left,
    y: strip.y,
    width: Math.min(box.x + box.width + 40 - left, 1680 - left),
    height: strip.height,
  },
});

// The overlay remembers a chosen theme, which would outrank GitHub's. Drop
// everything this profile remembers, so each shot starts from the page
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForFunction(() => document.getElementById('diffshub-for-github-viewer') != null, {
  timeout: 30000,
});
await page.waitForTimeout(6000);
await viewerFrame()?.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
  }
});

// 2. The hero: the overlay in dark mode.
await loadPullRequest(url);
let frame = await openOverlay('dark');
await shoot('overlay-dark');

// 3. The shortcut help dialog, over the same diff.
await frame.locator('.dh-code').click({ position: { x: 6, y: 6 } });
await page.keyboard.press('Shift+Slash');
await frame.locator('.dh-help').waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
await shoot('shortcut-help');
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

// 4. The exclude filter, with the hidden count. Cropped to the sidebar and the
//    first column of the diff, so the count is legible
await frame.locator('.dh-field input').nth(1).fill('deps/**, test/**');
await frame.locator('.dh-hidden').waitFor({ timeout: 30000 });
await page.waitForTimeout(5000);
await shoot('exclude-filter', { clip: { x: 0, y: 0, width: 920, height: 1050 } });
await frame.locator('.dh-field input').nth(1).fill('');
await page.waitForTimeout(4000);

// 5. The same overlay in light mode.
await loadPullRequest(url);
frame = await openOverlay('light');
await shoot('overlay-light');

console.log(`\nimages: ${images}`);
await context.close();
