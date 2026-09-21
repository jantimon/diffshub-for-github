import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Everything that reads or writes review state on GitHub, run against our own
// open pull request. A merged one refuses the writes.
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/1';
const shots = path.resolve(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const context = await chromium.launchPersistentContext(
  process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
  {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1600, height: 1000 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  }
);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);

const frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
if (frame == null) {
  console.log('FAIL: no viewer frame');
  await context.close();
  process.exit(1);
}

const check = async (name, fn) => {
  try {
    const value = await fn();
    console.log(`${value ? 'ok  ' : 'FAIL'}  ${name}${value && value !== true ? ` — ${value}` : ''}`);
    return value ? 0 : 1;
  } catch (error) {
    console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`);
    return 1;
  }
};

let failures = 0;

// Marking a file viewed is a real write; remember what to put back.
const reviewed = [];
page.on('response', (r) => {
  if (!r.url().includes('/file_review')) return;
  const body = r.request().postData();
  reviewed.push({ status: r.status(), path: body == null ? null : JSON.parse(body).path });
});

failures += await check('thread renders', async () => {
  const count = await frame.locator('.dh-thread').count();
  return count > 0 ? `${count} thread(s)` : false;
});
failures += await check('comment shows its author and body', async () => {
  const text = (await frame.locator('.dh-comment').first().textContent())?.trim() ?? '';
  return text.includes('jantimon') && text.length > 20 ? text.slice(0, 60) : false;
});
failures += await check('thread sits inside the diff', async () => {
  const inside = await frame.evaluate(() => {
    const thread = document.querySelector('.dh-thread');
    return thread != null && thread.closest('.dh-code') != null;
  });
  return inside && 'anchored in the viewer';
});

const marked = await frame.locator('[data-dh-viewed]').first().getAttribute('data-dh-viewed');

failures += await check('viewed state reaches GitHub', async () => {
  const before = reviewed.length;
  await frame.locator(`[data-dh-viewed="${marked}"]`).click();
  await page.waitForTimeout(3000);
  const sent = reviewed.slice(before);
  if (sent.length === 0) return false;
  const bad = sent.find((entry) => entry.status !== 200);
  if (bad != null) { console.log(`      GitHub answered ${bad.status}`); return false; }
  return `${sent[0].path} accepted`;
});

failures += await check('the tick survives', async () => {
  const pressed = await frame.locator(`[data-dh-viewed="${marked}"]`).getAttribute('aria-pressed');
  return pressed === 'true' ? 'still marked after the write' : false;
});

failures += await check('the tree marks it', async () => {
  const marks = await frame.locator('[data-item-section="decoration"]', { hasText: '\u2713' }).count();
  return marks > 0 ? `${marks} mark(s)` : false;
});

await page.screenshot({ path: path.join(shots, 'comments.png') });

// Leave the pull request as we found it.
const touched = [...new Set(reviewed.map((entry) => entry.path).filter(Boolean))];
if (touched.length > 0) {
  const cleaned = await page.evaluate(async ({ paths, endpoint }) => {
    const results = [];
    for (const path of paths) {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'github-verified-fetch': 'true',
        },
        body: JSON.stringify({ path, viewed: 'unviewed' }),
      });
      results.push(res.status);
    }
    return results;
  }, { paths: touched, endpoint: `${new URL(url).pathname}/file_review` });
  console.log(`unmarked ${touched.length} file(s) on GitHub: ${cleaned.join(', ')}`);
}
console.log(`\nscreenshot: ${path.join(shots, 'comments.png')}`);
await context.close();
process.exit(failures === 0 ? 0 : 1);
