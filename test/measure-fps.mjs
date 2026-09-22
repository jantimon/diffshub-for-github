import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');
const pr = process.argv[2] ?? 'https://github.com/nodejs/node/pull/59805';

const context = await chromium.launchPersistentContext(
  process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
  {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1600, height: 1000 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  },
);

// Scrolls for a fixed number of frames and reports how long each one took
const SCROLL = (selector) => `
  new Promise((resolve) => {
    const target = ${selector};
    const frames = [];
    let last = performance.now();
    let count = 0;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (target === window) window.scrollBy(0, 220); else target.scrollTop += 220;
      if (++count < 180) requestAnimationFrame(tick);
      else {
        const sorted = [...frames].sort((a, b) => a - b);
        resolve({
          medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
          p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
          worstMs: Math.round(sorted.at(-1)),
          longFrames: frames.filter((f) => f > 50).length,
        });
      }
    };
    requestAnimationFrame(tick);
  })
`;

const report = (label, r) =>
  console.log(
    `${label.padEnd(22)} median ${String(r.medianMs).padStart(5)}ms (${Math.round(1000 / r.medianMs)} fps)   p95 ${String(r.p95Ms).padStart(6)}ms   worst ${String(r.worstMs).padStart(5)}ms   frames over 50ms: ${r.longFrames}/180`,
  );

const page = await context.newPage();
await page.goto(pr, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(30000);
const frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
report('DiffsHub overlay', await frame.evaluate(SCROLL(`document.querySelector('.dh-code')`)));
await page.close();

const ghPage = await context.newPage();
const started = Date.now();
await ghPage.goto(`${pr}/files`, { waitUntil: 'domcontentloaded' });
await ghPage.waitForTimeout(30000);
console.log(`GitHub /files loaded in ${Math.round((Date.now() - started) / 1000)}s`);
report('GitHub Files changed', await ghPage.evaluate(SCROLL('window')));

await context.close();
