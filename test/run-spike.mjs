import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const url = process.argv[2] ?? 'https://github.com/nodejs/node/pull/60000';

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
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);

const frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
if (frame == null) { console.log('FAIL: no viewer frame'); await context.close(); process.exit(1); }
frame.on('console', (m) => { if (m.type() === 'error') noise.push(`viewer: ${m.text().slice(0, 160)}`); });

const check = async (name, fn) => {
  try { const value = await fn(); console.log(`${value ? 'ok  ' : 'FAIL'}  ${name}${value && value !== true ? ` — ${value}` : ''}`); }
  catch (error) { console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`); }
};

await check('patch streamed', async () => (await frame.locator('.dh-stats').textContent())?.trim());
await check('file tree populated', async () => `${await frame.locator('[data-item-type="file"]').count()} files`);
await check('diff stats panel', async () => (await frame.locator('.dh-diffstats').isVisible()) && 'visible');
await check('per-file links', async () => `${await frame.locator('.dh-file-links').count()} headers`);

await check('hunk expansion', async () => {
  const label = frame.locator('[data-unmodified-lines]').first();
  const before = (await label.textContent())?.trim() ?? '';
  await frame.locator('[data-expand-button]').first().click();
  await page.waitForTimeout(4000);
  const after = (await label.textContent())?.trim() ?? '';
  return before !== after ? `${before} -> ${after}` : false;
});

await check('shortcut help', async () => {
  await frame.locator('.dh-code').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(600);
  return (await frame.locator('.dh-help').count()) > 0 && 'dialog open';
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

await page.screenshot({ path: path.resolve(root, '../.output/overlay.png') });
if (noise.length > 0) console.log('\nconsole noise:\n' + [...new Set(noise)].slice(0, 8).join('\n'));
await context.close();
