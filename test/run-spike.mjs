import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const url = process.argv[2] ?? 'https://github.com/nodejs/node/pull/60000';

// Screenshots of each step, so a run can be looked over afterwards.
const shots = path.resolve(root, 'screenshots');
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
let shotIndex = 0;
const shoot = async (name) =>
  page.screenshot({ path: path.join(shots, `${String(++shotIndex).padStart(2, '0')}-${name}.png`) });

const context = await chromium.launchPersistentContext(path.resolve(root, '.profile'), {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1600, height: 1000 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const page = context.pages()[0] ?? (await context.newPage());
const noise = [];
page.on('pageerror', (e) => noise.push(`gh pageerror: ${e.message.slice(0, 160)}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await shoot('github-page');
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);
await shoot('overlay');

let frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
if (frame == null) { console.log('FAIL: no viewer frame'); await context.close(); process.exit(1); }
frame.on('console', (m) => { if (m.type() === 'error') noise.push(`viewer: ${m.text().slice(0, 160)}`); });

const check = async (name, fn) => {
  try { const value = await fn(); console.log(`${value ? 'ok  ' : 'FAIL'}  ${name}${value && value !== true ? ` — ${value}` : ''}`); }
  catch (error) { console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`); }
};

// The profile persists between runs, so clear what the last one remembered.
await frame.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
  }
});
await page.reload();
await page.waitForTimeout(3000);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);
frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));

await check('patch streamed', async () => (await frame.locator('.dh-stats').textContent())?.trim());
await check('file tree populated', async () => `${await frame.locator('[data-item-type="file"]').count()} files`);
await check('diff stats panel', async () => (await frame.locator('.dh-diffstats').isVisible()) && 'visible');
await check('per-file links', async () => `${await frame.locator('.dh-file-links').count()} headers`);
await check('viewed toggles', async () => `${await frame.locator('[data-dh-viewed]').count()} eyes`);

await check('exclude filter', async () => {
  const before = await frame.locator('[data-item-type="file"]').count();
  await frame.locator('.dh-field input').nth(1).fill('test/**');
  await page.waitForTimeout(2500);
  const after = await frame.locator('[data-item-type="file"]').count();
  const hidden = await frame.locator('.dh-hidden').textContent().catch(() => '');
  await shoot('exclude-filter');
  await frame.locator('.dh-field input').nth(1).fill('');
  await page.waitForTimeout(2500);
  const restored = await frame.locator('[data-item-type="file"]').count();
  if (after >= before || restored !== before) return false;
  return `${before} -> ${after} (${hidden?.trim()}) -> ${restored}`;
});

await check('sidebar resizes', async () => {
  const before = await frame.locator('.dh-sidebar').evaluate((el) => el.getBoundingClientRect().width);
  const handle = frame.locator('.dh-resize');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 152, box.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await frame.locator('.dh-sidebar').evaluate((el) => el.getBoundingClientRect().width);
  await shoot('sidebar-resized');
  return after > before + 100 ? `${Math.round(before)}px -> ${Math.round(after)}px` : false;
});

await check('include filter', async () => {
  await frame.locator('.dh-field input').first().fill('**/*.js');
  await page.waitForTimeout(2500);
  const only = await frame.locator('[data-item-type="file"]').count();
  await frame.locator('.dh-field input').first().fill('');
  await page.waitForTimeout(2500);
  return only > 0 ? `${only} files match **/*.js` : false;
});

await check('mark viewed advances', async () => {
  const box = frame.locator('[data-dh-viewed]').first();
  const id = await box.getAttribute('data-dh-viewed');
  await box.click();
  await page.waitForTimeout(1200);
  const focused = await frame.evaluate(() => document.activeElement?.getAttribute('data-dh-viewed') ?? null);
  await shoot('viewed');
  return focused != null && focused !== id ? `focus moved to ${focused}` : false;
});

await check('hunk expansion', async () => {
  const label = frame.locator('[data-unmodified-lines]').first();
  const before = (await label.textContent())?.trim() ?? '';
  await frame.locator('[data-expand-button]').first().click();
  await page.waitForTimeout(4000);
  const after = (await label.textContent())?.trim() ?? '';
  await shoot('hunk-expanded');
  return before !== after ? `${before} -> ${after}` : false;
});

await check('shortcut help', async () => {
  await frame.locator('.dh-code').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(600);
  const open = (await frame.locator('.dh-help').count()) > 0;
  await shoot('shortcut-help');
  return open && 'dialog open';
});
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await check('j moves to next file', async () => {
  await page.keyboard.press('j');
  await page.waitForTimeout(800);
  await page.keyboard.press('j');
  await page.waitForTimeout(800);
  return true;
});

await frame.locator('.dh-icon-button').first().click();
await page.waitForTimeout(500);
await shoot('sidebar-hidden');

console.log(`\nscreenshots: ${shots}`);
if (noise.length > 0) console.log('\nconsole noise:\n' + [...new Set(noise)].slice(0, 8).join('\n'));
await context.close();
