/**
 * What the viewer does with a pull request it only reads.
 *
 * Nothing here writes to GitHub, so it runs against any public pull request and
 * needs no login. The checks that write have their own suite in `review.mjs`.
 */

import { checker, launch, openOverlay, screenshots } from './browser.mjs';

/**
 * A pull request big enough that the viewer recycles rows as you scroll, and
 * small enough to record.
 *
 * Ten files stayed rendered all at once, so the checks never met the recycling
 * that several real bugs lived in: which file `j` thinks you are on, which
 * folder counts as read, and an annotation surviving its row being reused.
 * Forty files across two languages do meet it.
 */
const url = process.argv[2] ?? 'https://github.com/microsoft/TypeScript/pull/64204';

const { context, page, noise } = await launch({ har: true });
const { dir, shoot } = screenshots(page);
const { check, finish } = checker();

const frame = await openOverlay(page, url, { noise });
if (frame == null) {
  console.log('FAIL  the viewer did not open');
  await context.close();
  process.exit(1);
}

await shoot('overlay');

await check('patch streamed', async () => (await frame.locator('.dh-stats').textContent())?.trim());
await check(
  'file tree populated',
  async () => `${await frame.locator('[data-item-type="file"]').count()} files`,
);
await check('diff stats panel', async () => (await frame.locator('.dh-diffstats').isVisible()) && 'visible');
// Reaching into the viewer's nested shadow roots directly: a plain locator
// does not resolve the separator reliably while files are still settling
const inViewer = (action) =>
  frame.evaluate((what) => {
    const find = (root, depth) => {
      if (depth > 6) return null;
      const hit = root.querySelector('[data-unmodified-lines]');
      if (hit != null) return hit;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot == null) continue;
        const found = find(el.shadowRoot, depth + 1);
        if (found != null) return found;
      }
      return null;
    };
    const label = find(document, 0);
    if (label == null) return null;
    if (what === 'click') label.click();
    return label.textContent?.trim() ?? '';
  }, action);

await check('the author is shown', async () => {
  const avatar = frame.locator('.dh-author img');
  if ((await avatar.count()) === 0) return false;
  const loaded = await avatar.evaluate((img) => img.complete && img.naturalWidth > 0);
  const who = await frame.locator('.dh-author').getAttribute('title');
  return loaded ? who : false;
});

await check('per-file links', async () => `${await frame.locator('.dh-file-links').count()} headers`);
await check('viewed toggles', async () => `${await frame.locator('[data-dh-viewed]').count()} eyes`);

await check('exclude filter', async () => {
  const before = await frame.locator('[data-item-type="file"]').count();
  await frame.locator('.dh-field input').nth(1).fill('tsc/**');
  await page.waitForTimeout(2500);
  const after = await frame.locator('[data-item-type="file"]').count();
  const hidden = await frame
    .locator('.dh-hidden')
    .textContent()
    .catch(() => '');
  await shoot('exclude-filter');
  await frame.locator('.dh-field input').nth(1).fill('');
  await page.waitForTimeout(2500);
  const restored = await frame.locator('[data-item-type="file"]').count();
  if (after >= before || restored !== before) return false;
  return `${before} -> ${after} (${hidden?.trim()}) -> ${restored}`;
});

await check('a folder is ticked once every file under it is read', async () => {
  // The tree names a folder with a trailing slash and a file without one, and
  // counts the two separately. If the tally and the tree disagree on the name,
  // no folder ever gets ticked
  const ticks = () =>
    frame.evaluate(() => {
      const out = { file: 0, folder: 0 };
      const walk = (root, depth) => {
        if (depth > 6) return;
        for (const row of root.querySelectorAll('[data-item-path]')) {
          const mark = row.querySelector('[data-item-section="decoration"]');
          if (mark?.textContent?.includes('\u2713') !== true) continue;
          out[row.getAttribute('data-item-type') === 'folder' ? 'folder' : 'file'] += 1;
        }
        for (const el of root.querySelectorAll('*'))
          if (el.shadowRoot != null) walk(el.shadowRoot, depth + 1);
      };
      walk(document, 0);
      return out;
    });

  /**
   * Only the files on screen have an eye, and GitHub may already have marked
   * them viewed, so this unticks a file and ticks it again. The second click is
   * the change being checked, and the pair leaves the pull request as found.
   *
   * A tick needs a signed-in reader, and the recorded run is signed out so the
   * recording carries no session, so there it reports nothing to do.
   */
  const eye = frame.locator('[data-dh-viewed][aria-pressed="true"]').first();
  if ((await eye.count()) === 0) {
    console.log('      skipped: no file is ticked, which needs a signed-in session');
    return 'skipped, needs a session';
  }

  await eye.click();
  await page.waitForTimeout(2500);
  const unticked = await ticks();

  await frame.locator('[data-dh-viewed][aria-pressed="false"]').first().click();
  await page.waitForTimeout(2500);
  const ticked = await ticks();
  await shoot('folder-ticked');

  // Ticking a file jumps to the next one still to read, so put the view back
  // at the top for the checks that follow
  await frame.locator('.dh-code').evaluate((pane) => pane.scrollTo({ top: 0 }));
  await page.waitForTimeout(1500);

  if (!(ticked.file > unticked.file && ticked.folder > unticked.folder)) {
    console.log(`      files ${unticked.file}->${ticked.file}, folders ${unticked.folder}->${ticked.folder}`);
    return false;
  }
  return `${ticked.folder - unticked.folder} folders, ${ticked.file - unticked.file} file`;
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
  await frame.locator('.dh-field input').first().fill('**/*.ts');
  await page.waitForTimeout(2500);
  const only = await frame.locator('[data-item-type="file"]').count();
  await frame.locator('.dh-field input').first().fill('');
  await page.waitForTimeout(2500);
  return only > 0 ? `${only} files match **/*.ts` : false;
});

await check('hunk expansion', async () => {
  // Start from the top. The checks before this one scroll and filter, and on a
  // diff long enough to recycle rows the first separator is otherwise wherever
  // they happened to leave it, or not rendered at all
  await frame.locator('.dh-code').evaluate((pane) => pane.scrollTo({ top: 0 }));
  await page.waitForTimeout(2000);

  const label = frame.locator('[data-unmodified-lines]').first();
  const before = (await label.textContent())?.trim() ?? '';

  const expand = frame.locator('[data-expand-button]').first();
  await expand.scrollIntoViewIfNeeded({ timeout: 10000 });
  await expand.dispatchEvent('click');
  await page.waitForTimeout(4000);
  const after = (await label.textContent())?.trim() ?? '';
  await shoot('hunk-expanded');
  return before !== after ? `${before} -> ${after}` : false;
});

await check('theme switch', async () => {
  const before = await frame.locator('.dh-overlay').getAttribute('data-theme');
  const button = frame.locator('[data-dh-action="theme"]');
  await button.click();
  await page.waitForTimeout(1500);
  const after = await frame.locator('.dh-overlay').getAttribute('data-theme');
  await shoot('theme-switched');
  await button.click();
  await page.waitForTimeout(1000);
  return after !== before ? `${before} -> ${after}` : false;
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

// The virtualiser owns the scrolling element, so this finds it by behaviour:
// the thing with somewhere to scroll, rather than by a class name that is not
// ours to depend on
const scrolled = () =>
  frame.evaluate(() => {
    let furthest = 0;
    const walk = (root, depth) => {
      if (depth > 6) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.scrollHeight - el.clientHeight > 200) furthest = Math.max(furthest, el.scrollTop);
        if (el.shadowRoot != null) walk(el.shadowRoot, depth + 1);
      }
    };
    walk(document, 0);
    return furthest;
  });

await check('j keeps moving down the diff', async () => {
  const start = await scrolled();
  await page.keyboard.press('j');
  await page.waitForTimeout(1200);
  const once = await scrolled();
  await page.keyboard.press('j');
  await page.waitForTimeout(1200);
  const twice = await scrolled();
  // Pressing it a second time has to move again: a check that pressed once
  // would pass even if the diff stopped moving after the first press
  if (!(once > start && twice > once)) {
    console.log(`      ${start} -> ${once} -> ${twice}`);
    return false;
  }
  return `${Math.round(start)} -> ${Math.round(once)} -> ${Math.round(twice)}`;
});

await check('separator bar expands', async () => {
  const before = await inViewer('read');
  if (before == null) return false;
  await inViewer('click');
  await page.waitForTimeout(3500);
  const after = await inViewer('read');
  await shoot('separator-clicked');
  return before !== after ? `${before} -> ${after}` : false;
});

await check('closing and reopening asks GitHub for nothing', async () => {
  const asked = [];
  const watch = (request) => {
    const target = request.url();
    if (/patch-diff|\.diff$|page_data\/|\/raw\//.test(target)) asked.push(target.split('/').pop());
  };
  page.on('request', watch);

  await frame.locator('[data-dh-action="close"]').click();
  await page.waitForTimeout(1200);
  const gone =
    (await frame
      .locator('.dh-code')
      .isVisible()
      .catch(() => false)) === false;

  await page.locator('[data-diffshub-marked]').first().click();
  await page.waitForTimeout(2500);
  const back = await frame.locator('[data-item-type="file"]').count();
  page.off('request', watch);

  if (!gone) return false;
  if (asked.length > 0) {
    console.log(`      asked for ${asked.length}: ${asked.slice(0, 3).join(', ')}`);
    return false;
  }
  return `reopened with ${back} files, no requests`;
});

await frame.locator('[data-dh-action="sidebar"]').click();
await page.waitForTimeout(500);
await shoot('sidebar-hidden');

console.log(`\nscreenshots: ${dir}`);
await finish(context, noise);
