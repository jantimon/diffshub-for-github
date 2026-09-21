import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A pull request that mixes a reindented file with a real edit, so the toggle
// has something to hide and something to keep.
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/2';

const context = await chromium.launchPersistentContext(
  process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
  {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1500, height: 950 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  }
);

const page = context.pages()[0] ?? (await context.newPage());
const open = async () => {
  await page.locator('[data-diffshub-marked]').first().click();
  await page.waitForTimeout(12000);
  return page.frames().find((f) => f.url().startsWith('chrome-extension://'));
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
let frame = await open();
if (frame == null) {
  console.log('FAIL: no viewer frame');
  await context.close();
  process.exit(1);
}

// The toggle is remembered, so start from a known state.
await frame.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
frame = await open();

let failures = 0;
const check = async (name, fn) => {
  try {
    const value = await fn();
    console.log(`${value ? 'ok  ' : 'FAIL'}  ${name}${value && value !== true ? ` — ${value}` : ''}`);
    if (!value) failures += 1;
  } catch (error) {
    console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`);
    failures += 1;
  }
};

const fileCount = () => frame.locator('[data-item-type="file"]').count();
const before = await fileCount();

await check('every file is shown to begin with', async () => (before > 1 ? `${before} files` : false));

await check('the toggle hides a reindented file', async () => {
  await frame.locator('[data-dh-action="whitespace"]').click();
  await page.waitForTimeout(3000);
  const after = await fileCount();
  const note = (await frame.locator('.dh-hidden').allTextContents()).join(' ');
  if (after >= before) { console.log(`      ${before} -> ${after} files`); return false; }
  if (!note.includes('spacing')) { console.log(`      no note: ${note}`); return false; }
  return `${before} -> ${after} files, and says why`;
});

await check('a real change is kept', async () => (await fileCount()) > 0);

await check('turning it off brings the file back', async () => {
  await frame.locator('[data-dh-action="whitespace"]').click();
  await page.waitForTimeout(3000);
  const after = await fileCount();
  return after === before ? `${after} files again` : false;
});

await page.screenshot({ path: path.resolve(root, 'screenshots', 'ignore-whitespace.png') });
await context.close();
process.exit(failures === 0 ? 0 : 1);
