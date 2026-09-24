/**
 * What the viewer does with a pull request it only reads.
 *
 * Nothing here writes to GitHub, so it runs against any public pull request and
 * needs no login. The checks that write have their own suite in `review.mjs`.
 */

import {
  checker,
  launch,
  openOverlay,
  openViewer,
  screenshots,
  scrollSettled,
  until,
  viewerFrame,
} from './browser.mjs';

/**
 * A pull request big enough that the viewer recycles rows as you scroll, and
 * small enough to record.
 *
 * Ten files stay rendered all at once, so the checks would never meet the
 * recycling that matters: which file `j` thinks you are on, which folder
 * counts as read, and an annotation surviving its row being reused. Forty
 * files across two languages do meet it.
 */
const url = process.argv[2] ?? 'https://github.com/microsoft/TypeScript/pull/64204';

const { context, page, noise } = await launch({ har: true });
const { dir, shoot } = screenshots(page);
const { check, finish } = checker();

/**
 * GitHub's patch host refuses with a 503 under load, so the first ask for the
 * patch is refused here, and the viewer has to ask again on its own. Routes
 * added later run first, so this sits in front of the recording
 */
let refusedPatches = 0;
await context.route(/\/pull\/\d+\.diff$/, (route) => {
  if (refusedPatches > 0) return route.fallback();
  refusedPatches += 1;
  return route.fulfill({ status: 503, body: 'refused by the test' });
});

const frame = await openOverlay(page, url, { noise });
if (frame == null) {
  console.log('FAIL  the viewer did not open');
  await context.close();
  process.exit(1);
}

await shoot('overlay');

// A count of zero is not a pass: an empty diff renders the same toolbar and tree
await check('the diff renders', async () => {
  const files = await frame.locator('[data-item-type="file"]').count();
  const stats = (await frame.locator('.dh-stats').textContent())?.trim() ?? '';
  return files > 0 && /\+[1-9]/.test(stats) ? `${files} files, ${stats}` : false;
});

await check('a patch refused with 503 is asked for again', async () => {
  const files = await frame.locator('[data-item-type="file"]').count();
  return refusedPatches === 1 && files > 0 ? `refused once, then ${files} files` : false;
});

/**
 * The tree rows the in-view bar runs beside. The tree pins copies of folder
 * rows at its top, which are left out
 */
const barRows = () =>
  frame.evaluate(() => {
    const root = document.querySelector('.dh-tree')?.shadowRoot;
    const bar = root?.querySelector('[data-dh-in-view]');
    if (bar == null || bar.hidden) return [];
    const edge = bar.getBoundingClientRect();
    return [...root.querySelectorAll('[role="treeitem"]')]
      .filter((row) => {
        const box = row.getBoundingClientRect();
        return box.bottom > edge.top + 1 && box.top < edge.bottom - 1;
      })
      .map((row) => row.dataset.itemPath);
  });

const FIRST_FILE = 'packages/typescript/src/api/async/api.ts';

await check('the tree marks the file on screen', async () => {
  const rows = await barRows();
  return rows.includes(FIRST_FILE) && rows.length < 5 ? `beside ${rows.join(', ')}` : false;
});

/** Whether anything matches `selector` in the viewer */
const shows = async (selector) => (await frame.locator(selector).count()) > 0;

/**
 * Whether a key pressed now reaches the viewer, without clicking into it
 * first. `?` is used because it opens something the check can see
 */
const keysReachTheViewer = async () => {
  await page.keyboard.press('Shift+Slash');
  const open = (await until(() => shows('.dh-help'), { timeout: 2000 })) === true;
  if (open) await page.keyboard.press('Escape');
  await until(async () => !(await shows('.dh-help')), { timeout: 2000 });
  return open;
};

await check('opening puts the keyboard in the viewer', async () =>
  (await keysReachTheViewer()) ? 'a key pressed straight away reached it' : false,
);

await check('the author is shown', async () => {
  const avatar = frame.locator('.dh-author img');
  if ((await avatar.count()) === 0) return false;
  const loaded = await avatar.evaluate((img) => img.complete && img.naturalWidth > 0);
  const who = await frame.locator('.dh-author').getAttribute('title');
  return loaded ? who : false;
});

await check('exclude filter', async () => {
  const files = () => frame.locator('[data-item-type="file"]').count();
  const before = await files();
  await frame.locator('.dh-field input').nth(1).fill('tsc/**');
  const after = (await until(async () => ((await files()) < before ? files() : false))) ?? before;
  const hidden = await frame
    .locator('.dh-hidden')
    .textContent()
    .catch(() => '');
  await shoot('exclude-filter');
  await frame.locator('.dh-field input').nth(1).fill('');
  const restored =
    (await until(async () => ((await files()) === before ? before : false))) ?? (await files());
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

  const start = await ticks();
  await eye.click();
  const unticked =
    (await until(async () => {
      const now = await ticks();
      return now.file < start.file ? now : false;
    })) ?? (await ticks());

  await frame.locator('[data-dh-viewed][aria-pressed="false"]').first().click();
  const ticked =
    (await until(async () => {
      const now = await ticks();
      return now.file > unticked.file ? now : false;
    })) ?? (await ticks());
  await shoot('folder-ticked');

  // Ticking a file jumps to the next one still to read, so put the view back
  // at the top for the checks that follow
  await frame.locator('.dh-code').evaluate((pane) => pane.scrollTo({ top: 0 }));

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
  const width = () => frame.locator('.dh-sidebar').evaluate((el) => el.getBoundingClientRect().width);
  await until(async () => (await width()) > before + 100, { timeout: 2000 });
  const after = await width();
  await shoot('sidebar-resized');
  return after > before + 100 ? `${Math.round(before)}px -> ${Math.round(after)}px` : false;
});

await check('include filter', async () => {
  const files = () => frame.locator('[data-item-type="file"]').count();
  const before = await files();
  await frame.locator('.dh-field input').first().fill('**/*.ts');
  const only = (await until(async () => ((await files()) !== before ? files() : false))) ?? 0;
  await frame.locator('.dh-field input').first().fill('');
  await until(async () => (await files()) === before);
  return only > 0 ? `${only} files match **/*.ts` : false;
});

await check('hunk expansion', async () => {
  // Start from the top. The checks before this one scroll and filter, and on a
  // diff long enough to recycle rows the first separator is otherwise wherever
  // they happened to leave it, or not rendered at all
  await frame.locator('.dh-code').evaluate((pane) => pane.scrollTo({ top: 0 }));

  const label = frame.locator('[data-unmodified-lines]').first();
  await label.waitFor();
  const before = (await label.textContent())?.trim() ?? '';

  const expand = frame.locator('[data-expand-button]').first();
  await expand.scrollIntoViewIfNeeded({ timeout: 10000 });
  await expand.dispatchEvent('click');
  const after =
    (await until(async () => {
      const now = (await label.textContent())?.trim() ?? '';
      return now !== before ? now : false;
    })) ?? before;
  await shoot('hunk-expanded');
  return before !== after ? `${before} -> ${after}` : false;
});

await check('theme switch', async () => {
  const before = await frame.locator('.dh-overlay').getAttribute('data-theme');
  const button = frame.locator('[data-dh-action="theme"]');
  const theme = () => frame.locator('.dh-overlay').getAttribute('data-theme');
  await button.click();
  const after = (await until(async () => ((await theme()) !== before ? theme() : false))) ?? before;
  await page.waitForTimeout(500);
  await shoot('theme-switched');
  await button.click();
  await until(async () => (await theme()) === before);
  return after !== before ? `${before} -> ${after}` : false;
});

await check('the comments toggle takes the conversations off the diff', async () => {
  // The recorded pull request has threads on files well down the diff, so this
  // counts what the viewer has drawn rather than what it could draw
  const threads = () => frame.locator('.dh-thread').count();
  const gutter = () => frame.locator('[data-gutter-utility-slot]').count();

  const before = await threads();
  if (before === 0) {
    console.log('      skipped: no conversation is on screen');
    return 'skipped, nothing drawn';
  }

  const button = frame.locator('[data-dh-action="comments"]');
  await button.click();
  const hidden = (await until(async () => ((await threads()) === 0 ? 0 : false))) ?? (await threads());
  const hiddenGutter = await gutter();
  await shoot('comments-hidden');

  await button.click();
  const back = (await until(async () => ((await threads()) > 0 ? threads() : false))) ?? 0;

  if (hidden !== 0 || hiddenGutter !== 0 || back === 0) {
    console.log(`      threads ${before} -> ${hidden} -> ${back}, gutter ${hiddenGutter}`);
    return false;
  }
  return `${before} -> ${hidden} -> ${back}`;
});

await check('shortcut help', async () => {
  await frame.locator('.dh-code').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Slash');
  const open = (await until(() => shows('.dh-help'), { timeout: 3000 })) === true;
  const groups = await frame.locator('.dh-help-group h3').count();
  // A long key combination must not run into its description
  const overlapping = await frame.evaluate(
    () =>
      [...document.querySelectorAll('.dh-help-row')].filter(
        (row) =>
          row.querySelector('dt').getBoundingClientRect().right >
          row.querySelector('dd').getBoundingClientRect().left,
      ).length,
  );
  await shoot('shortcut-help');
  if (!open || groups !== 4 || overlapping > 0) {
    console.log(`      open ${open}, groups ${groups}, rows whose keys overlap their text ${overlapping}`);
    return false;
  }
  return 'four groups, no keys over their text';
});
await page.keyboard.press('Escape');
await until(async () => !(await shows('.dh-help')), { timeout: 2000 });

// Nothing is submitted: the dialog is only opened and closed
await check('approving offers to mark the remaining files, unticked', async () => {
  await frame.locator('[data-dh-action="review"]').click();
  await until(() => shows('.dh-review'), { timeout: 3000 });
  const offer = frame.locator('.dh-review-mark-all input');
  const withComment = await offer.count();
  await frame.locator('[data-verdict="approve"]').click();
  await until(async () => (await offer.count()) > 0, { timeout: 2000 });
  const withApprove = await offer.count();
  const ticked = withApprove > 0 && (await offer.isChecked());
  await shoot('review-mark-all');
  await page.keyboard.press('Escape');
  await until(async () => !(await shows('.dh-review')), { timeout: 2000 });
  if (withComment !== 0 || withApprove !== 1 || ticked) {
    console.log(`      offered with comment ${withComment}, with approve ${withApprove}, ticked ${ticked}`);
    return false;
  }
  return (await frame.locator('.dh-review-mark-all').count()) === 0 && 'shown for approve only, off';
});

// A dialog handles its own Esc: it closes the dialog and leaves the viewer open
await check('Esc in a dialog closes the dialog, not the viewer', async () => {
  const closed = [];
  for (const [name, opener, selector] of [
    ['review', '[data-dh-action="review"]', '.dh-review'],
    ['shortcuts', '[data-dh-action="help"]', '.dh-help'],
  ]) {
    await frame.locator(opener).click();
    await until(() => shows(selector), { timeout: 3000 });
    await page.keyboard.press('Escape');
    await until(async () => !(await shows(selector)), { timeout: 2000 });
    const dialogGone = (await frame.locator(selector).count()) === 0;
    const viewerOpen = await page.locator('#diffshub-for-github-viewer').isVisible();
    if (!dialogGone || !viewerOpen) {
      console.log(`      ${name}: dialog closed ${dialogGone}, viewer still open ${viewerOpen}`);
      return false;
    }
    closed.push(name);
  }
  return `${closed.join(' and ')} closed alone`;
});

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

/**
 * The first line of the new side on screen below the sticky file header, which
 * is what `n` and `p` step from
 */
const firstLineOnScreen = () =>
  frame.evaluate(() => {
    const pane = document.querySelector('.dh-code').getBoundingClientRect().top;
    for (const host of document.querySelectorAll('diffs-container')) {
      const header =
        host.shadowRoot.querySelector('[data-diffs-header]')?.getBoundingClientRect().bottom ?? pane;
      const below = Math.max(pane, header);
      for (const row of host.shadowRoot.querySelectorAll('code:not([data-deletions]) [data-line]')) {
        if (row.dataset.lineType === 'change-deletion') continue;
        const { top, bottom } = row.getBoundingClientRect();
        if ((top + bottom) / 2 > below) return Number(row.dataset.line);
      }
    }
    return undefined;
  });

await check('n and p step from hunk to hunk', async () => {
  await frame.locator('.dh-code').evaluate((pane) => pane.scrollTo({ top: 0 }));
  await scrollSettled(frame);
  await frame.locator('.dh-code').click({ position: { x: 5, y: 5 } });
  const seen = [await firstLineOnScreen()];
  for (const key of ['n', 'n', 'n', 'p']) {
    await page.keyboard.press(key);
    await scrollSettled(frame);
    seen.push(await firstLineOnScreen());
  }
  // Each n lands on the first line of the next hunk, and p goes back one. The
  // gap above the first hunk may be open by now, so the file can start above 58
  const hunks = [58, 86, 157, 170];
  const at = hunks.indexOf(seen[1] ?? -1);
  const stepped = at >= 0 && seen[2] === hunks[at + 1] && seen[3] === hunks[at + 2] && seen[4] === seen[2];
  if (!stepped) {
    console.log('      first lines', JSON.stringify(seen));
    return false;
  }
  return seen.join(' → ');
});

await check('j keeps moving down the diff', async () => {
  const start = await scrolled();
  await page.keyboard.press('j');
  await scrollSettled(frame);
  const once = await scrolled();
  await page.keyboard.press('j');
  await scrollSettled(frame);
  const twice = await scrolled();
  // Pressing it a second time has to move again: a check that pressed once
  // would pass even if the diff stopped moving after the first press
  if (!(once > start && twice > once)) {
    console.log(`      ${start} -> ${once} -> ${twice}`);
    return false;
  }
  return `${Math.round(start)} -> ${Math.round(once)} -> ${Math.round(twice)}`;
});

/**
 * The recorded patch has this 28 times ignoring case. The 24 written this way
 * are all on removed lines, the other four are `apiFileChanges` elsewhere
 */
const FOUND_ON_REMOVED_LINES = 'APIFileChanges';

const findBar = frame.locator('[data-dh-find]');
const findBox = frame.locator('[data-dh-find] input');
const findCount = async () => (await frame.locator('.dh-find-count').textContent())?.trim() ?? '';
/** "3 of 28" as numbers, so a check can say where it started without assuming the first match */
const position = (text) => {
  const found = /^([\d,]+) of ([\d,]+)$/.exec(text);
  return found == null
    ? undefined
    : { at: Number(found[1].replace(/,/g, '')), of: Number(found[2].replace(/,/g, '')) };
};
/** The bar says `pending` from a keystroke until the search has caught up */
const searched = () => until(() => shows('[data-dh-find="done"]'), { timeout: 3000 });
const findFor = async (text) => {
  await findBox.fill(text);
  await searched();
  return findCount();
};
/** Does `action` and answers the count once it has changed, or after two seconds if it does not */
const countAfter = async (action) => {
  const before = await findCount();
  await action();
  await until(async () => (await findCount()) !== before, { timeout: 2000 });
  return findCount();
};
const highlights = () =>
  frame.evaluate(() => ({
    all: CSS.highlights.get('dh-find')?.size ?? 0,
    current: CSS.highlights.get('dh-find-current')?.size ?? 0,
  }));

await check('the mark follows the diff, and a closed folder takes it', async () => {
  const rows = await barRows();
  const file = rows.find((path) => !path.endsWith('/'));
  if (file == null || rows.includes(FIRST_FILE)) {
    console.log('      beside', JSON.stringify(rows));
    return false;
  }
  const folder = `${file.split('/').slice(0, -1).join('/')}/`;
  const folderRow = frame.locator(`[role="treeitem"][data-item-path="${folder}"]`);
  await folderRow.click();
  const closed =
    (await until(async () => ((await barRows()).includes(folder) ? barRows() : false), { timeout: 2000 })) ??
    (await barRows());
  await folderRow.click();
  const open =
    (await until(async () => ((await barRows()).includes(file) ? barRows() : false), { timeout: 2000 })) ??
    (await barRows());
  if (!closed.includes(folder) || !open.includes(file)) {
    console.log(`      closed ${JSON.stringify(closed)}, open again ${JSON.stringify(open)}`);
    return false;
  }
  return `moved to ${file.split('/').pop()}, onto ${folder} while it was closed, and back`;
});

await check('Cmd+F opens find instead of the browser’s', async () => {
  // Registered after the viewer's own listener, so it sees what that one did
  await frame.evaluate(() => {
    window.findKeyPrevented = undefined;
    addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'f') window.findKeyPrevented = event.defaultPrevented;
    });
  });
  await page.keyboard.press('ControlOrMeta+f');
  const inBox = () => frame.evaluate(() => document.activeElement?.closest('[data-dh-find]') != null);
  // The box takes the keyboard once the bar has been drawn
  const typing = (await until(inBox, { timeout: 2000 })) === true;
  const prevented = await frame.evaluate(() => window.findKeyPrevented);
  if ((await findBar.count()) === 0 || prevented !== true || !typing) {
    console.log(
      `      bar ${await findBar.count()}, browser's find held back ${prevented}, box focused ${typing}`,
    );
    return false;
  }
  return 'the bar opened with the keyboard in its box';
});

await check('find counts every match in the patch', async () => {
  const count = await findFor(FOUND_ON_REMOVED_LINES);
  const marked = await highlights();
  const tree = await frame.evaluate(() => {
    let sum = 0;
    const walk = (root) => {
      for (const mark of root.querySelectorAll('[data-item-type="file"] [data-item-section="decoration"]')) {
        sum += Number(mark.textContent) || 0;
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot != null) walk(el.shadowRoot);
    };
    walk(document);
    return sum;
  });
  await shoot('find');
  // It starts at the file being read, as a browser's find does, so not at 1
  if (position(count)?.of !== 28 || marked.current !== 1) {
    console.log(`      count "${count}", current marks ${marked.current}`);
    return false;
  }
  return `${count}, the tree counts ${tree} across the files it shows`;
});

await check('Enter steps through the matches and the diff follows', async () => {
  const start = position(await findCount());
  const top = await scrolled();
  // Back to the first match, so the steps below cross the end on purpose
  for (let at = start?.at ?? 1; at > 1; at -= 1) await findBox.press('Shift+Enter');
  const first = await findCount();
  const third = await countAfter(async () => {
    await findBox.press('Enter');
    await findBox.press('Enter');
  });
  await scrollSettled(frame);
  const moved = (await scrolled()) !== top;
  const second = await countAfter(() => findBox.press('Shift+Enter'));
  await findBox.press('Shift+Enter');
  const notice = await countAfter(() => findBox.press('Shift+Enter'));
  // The notice stands in for the count for a moment
  const wrapped = await until(
    async () => {
      const text = await findCount();
      return text !== notice && text;
    },
    { timeout: 4000 },
  );
  const seen = [first, third, second, notice, wrapped];
  const expected = ['1 of 28', '3 of 28', '2 of 28', 'Back to the last match', '28 of 28'];
  if (seen.join() !== expected.join() || !moved) {
    console.log(`      ${JSON.stringify(seen)}, moved ${moved}`);
    return false;
  }
  return seen.join(' → ');
});

await check('a match on a removed line is marked in the old column', async () => {
  const matchCase = frame.locator('[data-dh-find] button[title^="Match case"]');
  await countAfter(() => matchCase.click());
  await scrollSettled(frame);
  const where = await frame.evaluate(() => {
    const [range] = CSS.highlights.get('dh-find-current') ?? [];
    const row = range?.startContainer.parentElement?.closest('[data-line]');
    return row == null
      ? undefined
      : { old: row.closest('code')?.hasAttribute('data-deletions'), text: row.textContent };
  });
  if (where?.old !== true || !where.text.includes(FOUND_ON_REMOVED_LINES)) {
    console.log('      marked', JSON.stringify(where));
    await matchCase.click();
    return false;
  }
  await countAfter(() => matchCase.click());
  return `line reads "${where.text.trim().slice(0, 40)}"`;
});

await check('the switches change what is found', async () => {
  const toggle = (title) => frame.locator(`[data-dh-find] button[title^="${title}"]`).click();
  const cased = position(await countAfter(() => toggle('Match case')))?.of;
  await toggle('Match case');

  await toggle('Match whole word');
  const partWord = await findFor('APIFileChange');
  await toggle('Match whole word');

  await toggle('Use a regular expression');
  const either = position(await findFor('APIFileChange(s|Summary)'))?.of;
  const broken = await findFor('(');
  await countAfter(() => toggle('Use a regular expression'));

  const results = { cased, partWord, either, broken };
  if (cased !== 24 || partWord !== 'No matches' || either !== 28 || broken !== 'Invalid pattern') {
    console.log('      ', JSON.stringify(results));
    return false;
  }
  return 'case 24, whole word 0, regex 28, "(" reported';
});

await check('every match on screen is marked', async () => {
  await findFor('snapshot');
  const marked =
    (await until(
      async () => {
        const now = await highlights();
        return now.all > 0 && now.current === 1 && now;
      },
      { timeout: 2000 },
    )) ?? (await highlights());
  return marked.all > 0 && marked.current === 1 ? `${marked.all} marked besides the current one` : false;
});

await check('code in a collapsed gap is found once it is opened', async () => {
  // Only in the gap of 55 lines in this file, and nowhere in the patch
  const inTheGap = 'TimingAccumulators';
  const before = await findFor(inTheGap);
  await page.keyboard.press('Escape');
  await until(async () => !(await shows('[data-dh-find]')), { timeout: 2000 });

  await frame.locator('[data-item-path="packages/typescript/src/api/async/api.ts"]').first().click();
  await scrollSettled(frame);
  // The gap is a screen or two into the file, and rows exist only once near
  const gap = frame.locator('[data-unmodified-lines]', { hasText: '55 unmodified' }).first();
  for (let tries = 0; tries < 12 && (await gap.count()) === 0; tries += 1) {
    await frame.locator('.dh-code').evaluate((pane) => pane.scrollBy({ top: 250 }));
    await until(async () => (await gap.count()) > 0, { timeout: 300, every: 50 });
  }
  await gap.dispatchEvent('click');
  // The gap goes once the whole file has arrived and filled it
  await until(async () => (await gap.count()) === 0, { timeout: 15000 });

  await page.keyboard.press('ControlOrMeta+f');
  await searched();
  const after =
    (await until(async () => position(await findCount()) != null && findCount(), { timeout: 3000 })) ??
    (await findCount());
  if (before !== 'No matches' || position(after) == null) {
    console.log(`      before "${before}", after "${after}"`);
    return false;
  }
  return `"${before}" until opened, then "${after}"`;
});

await check('Esc closes find, and only find', async () => {
  await page.keyboard.press('Escape');
  await until(async () => !(await shows('[data-dh-find]')), { timeout: 2000 });
  const barGone = (await findBar.count()) === 0;
  const overlayOpen = await page.locator('#diffshub-for-github-viewer').isVisible();
  const marksGone = (await highlights()).all === 0;
  return barGone && overlayOpen && marksGone ? 'the overlay stayed open' : false;
});

await check('closing and reopening asks GitHub for nothing', async () => {
  const asked = [];
  const watch = (request) => {
    const target = request.url();
    if (/patch-diff|\.diff$|page_data\/|\/raw\//.test(target)) asked.push(target.split('/').pop());
  };
  page.on('request', watch);

  await frame.locator('[data-dh-action="close"]').click();
  await until(
    async () =>
      !(await frame
        .locator('.dh-code')
        .isVisible()
        .catch(() => false)),
    { timeout: 3000 },
  );
  const gone =
    (await frame
      .locator('.dh-code')
      .isVisible()
      .catch(() => false)) === false;
  const keyboardBack = await page.evaluate(() => document.activeElement?.tagName !== 'IFRAME');

  await page.locator('[data-diffshub-marked]').first().click();
  // A viewer that read the patch again would pass through loading, so the
  // requests are all in by the time it says ready
  await frame.locator('.dh-code').waitFor({ state: 'visible', timeout: 5000 });
  await frame.locator('.dh-overlay[data-dh-phase="ready"]').waitFor({ timeout: 10000 });
  const back = await frame.locator('[data-item-type="file"]').count();
  page.off('request', watch);
  const keyboardIn = await keysReachTheViewer();

  if (!gone || !keyboardBack || !keyboardIn) {
    console.log(
      `      hidden ${gone}, keyboard back on the page ${keyboardBack}, then in the viewer ${keyboardIn}`,
    );
    return false;
  }
  if (asked.length > 0) {
    console.log(`      asked for ${asked.length}: ${asked.slice(0, 3).join(', ')}`);
    return false;
  }
  return `reopened with ${back} files, no requests`;
});

await frame.locator('[data-dh-action="sidebar"]').click();
await page.waitForTimeout(500);
await shoot('sidebar-hidden');

/**
 * Last, because it reloads the page and every frame handle above it goes stale.
 *
 * The check before this one proves the overlay is kept rather than rebuilt, so
 * it cannot see a download either way. A reload rebuilds it, and only the
 * cache stops that costing the whole patch again -- 740 KB, from the host
 * that refuses under load.
 */
await check('a reload reuses the patch instead of fetching it again', async () => {
  const asked = [];
  const watch = (request) => {
    if (/patch-diff|\.diff(\?|$)/.test(request.url())) asked.push(request.url().slice(-60));
  };

  await page.reload();
  await page.locator('[data-diffshub-marked]').first().waitFor();
  page.on('request', watch);
  const reopened = await openViewer(page);
  page.off('request', watch);

  const files = reopened == null ? 0 : await reopened.locator('[data-item-type="file"]').count();
  if (files === 0) {
    console.log('      the viewer did not come back, so nothing was proved');
    return false;
  }
  if (asked.length > 0) {
    console.log(`      fetched ${asked.length}: ${asked.slice(0, 2).join(', ')}`);
    return false;
  }
  return `${files} files, no patch fetched`;
});

/**
 * After a push, the ticks kept from the last visit belong to an older commit
 * and are cleared as the viewer starts, before the file tree has mounted. That
 * must not leave the tree empty
 */
await check('the file tree fills after a push has cleared the ticks', async () => {
  const opened = viewerFrame(page);
  await opened?.evaluate(() =>
    localStorage.setItem(
      'diffshub-for-github.viewed.microsoft/TypeScript/64204',
      JSON.stringify({ sha: '0000000000000000000000000000000000000000', paths: [] }),
    ),
  );
  await page.reload();
  const tree = await (
    await openViewer(page)
  )?.evaluate(() => {
    const root = document.querySelector('.dh-tree')?.shadowRoot;
    return {
      rows: root?.querySelectorAll('[role="treeitem"]').length ?? 0,
      search: root?.querySelector('[data-file-tree-search-input]') != null,
    };
  });
  if (tree == null || tree.rows === 0 || !tree.search) {
    console.log('      tree', JSON.stringify(tree));
    return false;
  }
  return `${tree.rows} rows and the search field`;
});

console.log(`\nscreenshots: ${dir}`);
await finish(context, noise);
