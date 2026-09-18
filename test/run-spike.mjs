import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const profile = path.resolve(root, '.profile');
const url = process.argv[2] ?? 'https://github.com/nodejs/node/pull/60000';
const settle = Number(process.argv[3] ?? 15000);

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1600, height: 1000 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const log = (source) => (m) => {
  const text = typeof m.text === 'function' ? m.text() : String(m);
  if (/error|refus|block|violat|diffshub|fail/i.test(text)) console.log(`[${source}] ${text.slice(0, 300)}`);
};
context.on('page', (p) => { p.on('console', log('page')); p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300))); });
context.on('weberror', (e) => console.log('[weberror]', e.error().message.slice(0, 200)));

const page = context.pages()[0] ?? (await context.newPage());
page.on('console', log('gh'));
page.on('pageerror', (e) => console.log('[gh pageerror]', e.message.slice(0, 300)));
page.on('frameattached', (f) => console.log('[frame attached]'));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const tab = page.locator('[data-diffshub-marked]').first();
console.log('marked tab found:', (await tab.count()) > 0);
if ((await tab.count()) === 0) { await context.close(); process.exit(1); }

await tab.click();
await page.waitForTimeout(settle);

const frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
console.log('viewer frame:', frame?.url() ?? 'MISSING');
if (frame != null) {
  frame.on('console', log('viewer'));
  const summary = await frame.evaluate(() => ({
    stats: document.querySelector('.dh-stats')?.textContent,
    error: document.querySelector('.dh-error')?.textContent,
    fileElements: document.querySelectorAll('pierre-file-diff').length,
    treeRows: document.querySelectorAll('[data-item-type]').length,
  }));
  console.log('viewer:', JSON.stringify(summary));
}
const shot = path.resolve(root, '../.output/overlay.png');
await page.screenshot({ path: shot });
console.log('screenshot:', shot);
await context.close();
