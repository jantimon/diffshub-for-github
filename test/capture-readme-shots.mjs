import { launch, viewerFrame } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Presentation screenshots for the README. These are kept in git, so they go to docs/images and are shot at a large viewport
const root = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(root, '../docs/images');

/**
 * The pull request the suite records, so the shots replay offline like the
 * checks do. Any other pull request needs `DIFFSHUB_HAR=live` and its url as
 * the argument.
 */
const PULL_REQUEST = process.argv[2] ?? 'https://github.com/microsoft/TypeScript/pull/64204';

fs.mkdirSync(images, { recursive: true });

const { context, page } = await launch({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: 2,
  har: true,
});

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
  await page.locator('[data-diffshub-marked]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
};

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
    const frame = viewerFrame(page);
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
 * The recorded pull request opens on a stack of three review threads. This
 * scrolls past two of them, so the shot has one thread and the code under it,
 * which is the viewer doing both its jobs at once.
 */
const HERO_SCROLL = 540;

/**
 * Highlighting runs in a worker and lands after the lines do, so this waits
 * for the tokens before shooting. A half-coloured screenshot is worse than
 * none.
 */
const settleOnCode = async (frame) => {
  await frame.locator('.dh-code').evaluate((pane, top) => pane.scrollTo({ top }), HERO_SCROLL);
  let tokens = 0;
  for (let settle = 0; settle < 20; settle += 1) {
    tokens = await tokenCount(frame);
    if (tokens > 100) {
      await page.waitForTimeout(3000);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`the code never got its syntax colours: ${tokens} coloured tokens`);
};

const openOverlay = async (mode) => {
  await setColorMode(mode);
  await page.waitForTimeout(400);
  await page.locator('[data-diffshub-marked]').first().click();
  const frame = await waitForRenderedDiff();
  await settleOnCode(frame);
  return frame;
};

await loadPullRequest(PULL_REQUEST);
console.log(`capturing ${PULL_REQUEST}`);

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
await viewerFrame(page)?.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
  }
});

// 2. The hero: the overlay in dark mode.
await loadPullRequest(PULL_REQUEST);
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

// 4. Find: the bar, the count, the marks in the code and the counts in the
//    tree. Cropped to the top of the window, where all four are
await page.keyboard.press('ControlOrMeta+f');
await frame.locator('[data-dh-find] input').waitFor({ timeout: 15000 });
await frame.locator('[data-dh-find] input').fill('snapshot');
await page.waitForTimeout(2500);
await shoot('find', { clip: { x: 0, y: 0, width: 1680, height: 620 } });
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

// 5. The exclude filter, with the hidden count. Cropped to the sidebar, so the
//    count is legible
await frame.locator('.dh-field input').nth(1).fill('**/test/**, tools/**');
await frame.locator('.dh-hidden').waitFor({ timeout: 30000 });
await page.waitForTimeout(5000);
const sidebar = await frame.locator('.dh-sidebar').boundingBox();
await shoot('exclude-filter', {
  clip: { x: sidebar.x, y: sidebar.y, width: sidebar.width, height: 720 },
});
await frame.locator('.dh-field input').nth(1).fill('');
await page.waitForTimeout(4000);

// 6. The same overlay in light mode.
await loadPullRequest(PULL_REQUEST);
frame = await openOverlay('light');
await shoot('overlay-light');

console.log(`\nimages: ${images}`);
await context.close();
