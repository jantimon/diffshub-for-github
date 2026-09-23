import { checker, launch, openOverlay, until } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A pull request that mixes a reindented file with a real edit, so the toggle
// has something to hide and something to keep
const root = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/2';

const { context, page } = await launch({ viewport: { width: 1500, height: 950 } });

// The toggle is remembered, so the viewer's settings are cleared on the way in
const frame = await openOverlay(page, url);
if (frame == null) {
  console.log('FAIL: no viewer frame');
  await context.close();
  process.exit(1);
}

const { check, finish } = checker();

const fileCount = () => frame.locator('[data-item-type="file"]').count();
const before = await fileCount();

await check('every file is shown to begin with', async () => (before > 1 ? `${before} files` : false));

await check('the toggle hides a reindented file', async () => {
  await frame.locator('[data-dh-action="whitespace"]').click();
  const after = (await until(async () => ((await fileCount()) < before ? fileCount() : false))) ?? before;
  const note = (await frame.locator('.dh-hidden').allTextContents()).join(' ');
  if (after >= before) {
    console.log(`      ${before} -> ${after} files`);
    return false;
  }
  if (!note.includes('spacing')) {
    console.log(`      no note: ${note}`);
    return false;
  }
  return `${before} -> ${after} files, and says why`;
});

await check('a real change is kept', async () => (await fileCount()) > 0);

await check('turning it off brings the file back', async () => {
  await frame.locator('[data-dh-action="whitespace"]').click();
  const after =
    (await until(async () => ((await fileCount()) === before ? before : false))) ?? (await fileCount());
  return after === before ? `${after} files again` : false;
});

await page.screenshot({ path: path.resolve(root, 'screenshots', 'ignore-whitespace.png') });
await finish(context);
