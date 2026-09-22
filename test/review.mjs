import { launch, viewerFrame } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Everything that reads or writes review state on GitHub, run against our own
// open pull request. A merged one refuses the writes.
const root = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/1';
const shots = path.resolve(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const { context, page } = await launch({ viewport: { width: 1600, height: 1000 } });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);

let frame = viewerFrame(page);
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

// Marking a file viewed is a real write, so remember what to put back
const reviewed = [];
page.on('response', (r) => {
  if (!r.url().includes('/file_review')) return;
  const body = r.request().postData();
  reviewed.push({ status: r.status(), path: body == null ? null : JSON.parse(body).path });
});

// The profile persists between runs, so a file left ticked would make the click
// below an unmark and the assertions meaningless
await frame.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('diffshub-for-github.')) localStorage.removeItem(key);
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(10000);
frame = viewerFrame(page);

// The patch streams and the comments arrive in two paginated walks. The write
// checks below are about state, so let the overlay settle before touching it
await frame
  .locator('.dh-loading')
  .waitFor({ state: 'detached', timeout: 30000 })
  .catch(() => {});
await frame.locator('[data-dh-viewed]').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);

const marked = await frame.locator('[data-dh-viewed]').first().getAttribute('data-dh-viewed');

// Writes into the review box and previews it, without posting
failures += await check('markdown is written and previewed', async () => {
  await frame.locator('[data-dh-action="review"]').click();
  await page.waitForTimeout(1500);

  const buttons = await frame.locator('.dh-review-panel markdown-toolbar > *').count();
  if (buttons === 0) {
    console.log('      no toolbar');
    return false;
  }

  // GitHub's own toolbar element, working on the text box
  const box = frame.locator('.dh-review-panel .dh-editor-text');
  await box.fill('bold me and `code`');
  await box.evaluate((el) => {
    el.setSelectionRange(0, 7);
    el.focus();
  });
  await frame.locator('.dh-review-panel md-bold').click();
  await page.waitForTimeout(400);
  const written = await box.inputValue();
  if (!written.startsWith('**bold me**')) {
    console.log('      toolbar wrote', JSON.stringify(written));
    return false;
  }

  // GitHub renders the preview, so it matches what will be posted
  await frame.locator('.dh-review-panel [data-dh-tab="preview"]').click();
  await page.waitForTimeout(6000);
  const html = await frame.locator('.dh-review-panel [data-dh-preview]').innerHTML();
  if (!html.includes('<strong>') || !html.includes('<code')) {
    console.log('      preview came back as', html.slice(0, 120));
    return false;
  }

  await frame.locator('.dh-review-panel .dh-review-close').click();
  await page.waitForTimeout(800);
  return `${buttons} toolbar buttons, previewed by GitHub`;
});

/**
 * Every conversation below is one this run writes, so the suite does not rely on
 * the fixture holding threads from an earlier run, and leaves none behind.
 *
 * The run's own stamp finds them again: the virtualiser recycles rows, so a
 * position on screen names a different thread from one moment to the next
 */
const stamp = new Date().toISOString();
const written = `Written by the browser test at ${stamp}`;
const replied = `Replied by the browser test at ${stamp}`;
const TEST_TEXT = 'by the browser test at';

/** Markdown GitHub turns into more than a paragraph, so the render check has something to find */
const WRITTEN_BODY = `${written}\n\n**bold** and \`code\`\n\n- one\n- two`;

// Comments are posted on the last file, so that is where they are looked for
const mine = () => frame.locator('.dh-thread', { hasText: written }).first();
const showMine = async () => {
  await frame.locator('[data-item-type="file"]').last().click();
  await page.waitForTimeout(2500);
  await mine().waitFor({ timeout: 25000 });
};

/** Collects the answers to requests whose url matches, until `stop` is called */
const watchResponses = (pattern) => {
  const seen = [];
  const listener = (r) => {
    if (pattern.test(r.url())) seen.push(`${r.request().method()} ${r.status()}`);
  };
  page.on('response', listener);
  return { seen, stop: () => page.off('response', listener) };
};

/**
 * Deletes a comment through its own buttons. They are dispatched rather than
 * clicked, for the reason the reply check gives below
 */
const deleteComment = async (comment) => {
  await comment.locator('[data-dh-comment="delete"]').dispatchEvent('click');
  await comment.locator('[data-dh-comment="confirm-delete"]').dispatchEvent('click');
  await page.waitForTimeout(8000);
};

let posted = false;

failures += await check('a comment can be written', async () => {
  const answered = watchResponses(/create_review_comment/);

  await frame.locator('[data-item-type="file"]').last().click();
  await page.waitForTimeout(2000);

  const line = frame.locator('[data-line]').last();
  await line.scrollIntoViewIfNeeded();
  await line.hover();
  await page.waitForTimeout(900);
  const box = await frame.locator('[data-utility-button]').first().boundingBox();
  if (box == null) {
    answered.stop();
    console.log('      no gutter control appeared');
    return false;
  }
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  if ((await frame.locator('.dh-composer').count()) === 0) {
    answered.stop();
    console.log('      the composer did not open');
    return false;
  }

  await frame.locator('.dh-composer .dh-editor-text').fill(WRITTEN_BODY);
  await frame.locator('.dh-composer-send').click();
  await page.waitForTimeout(9000);
  answered.stop();

  if (!answered.seen.some((one) => one.endsWith(' 200'))) {
    console.log('      GitHub answered', JSON.stringify(answered.seen));
    return false;
  }
  posted = true;
  if ((await frame.locator('.dh-composer').count()) !== 0) {
    console.log('      the box stayed open');
    return false;
  }
  return 'posted, and the box closed';
});

failures += await check('thread renders', async () => {
  if (!posted) return false;
  await showMine();
  return 'the thread written above came back from GitHub';
});

failures += await check('comment shows its author and body', async () => {
  const text = (await mine().locator('.dh-comment').first().textContent())?.trim() ?? '';
  return text.includes('jantimon') && text.includes(written) ? text.slice(0, 60) : false;
});

failures += await check('a comment renders as GitHub renders it', async () => {
  const html = await mine().locator('.dh-markdown').first().innerHTML();
  const rendered = html.includes('<strong>') && html.includes('<code') && html.includes('<li');
  if (!rendered) console.log('      body came back as', html.slice(0, 160));
  return rendered && 'bold, code and a list';
});

failures += await check('thread sits inside the diff', async () => {
  const inside = await mine().evaluate((thread) => thread.closest('.dh-code') != null);
  return inside && 'anchored in the viewer';
});

failures += await check('a comment can be replied to', async () => {
  const answered = watchResponses(/review_comment\/create/);

  const thread = mine();
  await thread.locator('[data-dh-thread="reply"]').click({ timeout: 10000 });
  await thread.locator('.dh-editor-text').fill(replied);
  /**
   * The composer opens at the bottom of a long thread, so its buttons can sit
   * below the fold, where a click never becomes possible
   *
   * The send button is checked by hand and then clicked without Playwright's
   * actionability wait: the diff is virtualised, so rows are re-measured and
   * moved constantly and the button never counts as settled, even while it is
   * on screen and clickable
   */
  const send = thread.locator('.dh-composer-send');
  await send.scrollIntoViewIfNeeded({ timeout: 10000 });
  if (!(await send.isVisible()) || (await send.isDisabled())) {
    answered.stop();
    console.log('      the send button never became usable');
    return false;
  }
  // Dispatched rather than clicked: a forced click still lands wherever the
  // pointer is, and the virtualiser moves rows under it
  await send.dispatchEvent('click');
  await page.waitForTimeout(9000);
  answered.stop();

  const shown = await frame.locator('.dh-thread-error').allTextContents();
  if (shown.length > 0) {
    console.log('      ', shown.join(' | '));
    return false;
  }
  if (!answered.seen.some((one) => one.endsWith(' 200'))) {
    console.log('      GitHub answered', JSON.stringify(answered.seen));
    return false;
  }
  const shows = (await mine().locator('.dh-comment', { hasText: replied }).count()) > 0;
  return shows ? "posted through GitHub's own reply form" : false;
});

failures += await check('a conversation can be resolved and reopened', async () => {
  const answered = watchResponses(/page_data\/(un)?resolve_thread$/);

  await mine().locator('[data-dh-thread="resolve"]').click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  const resolved = await mine().getAttribute('data-resolved');

  await mine().locator('[data-dh-thread="resolve"]').click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  const reopened = await mine().getAttribute('data-resolved');
  answered.stop();

  const accepted = answered.seen.filter((one) => one.endsWith(' 200')).length;
  if (resolved !== 'true' || reopened !== 'false' || accepted < 2) {
    console.log(
      `      resolved ${resolved}, then ${reopened}, GitHub answered ${JSON.stringify(answered.seen)}`,
    );
    return false;
  }
  return answered.seen.join(', ');
});

/**
 * Rewrites the comment, then deletes the reply and the comment. The deletes are
 * also the cleanup: GitHub drops a thread once its last comment is gone
 */
failures += await check('your own comment can be edited and then deleted', async () => {
  if (!posted) return false;
  const answered = watchResponses(/update_review_comment|page_data\/review_comments\//);

  const first = mine().locator('.dh-comment', { hasText: written }).first();
  await first.locator('[data-dh-comment="edit"]').dispatchEvent('click');
  const edited = `${WRITTEN_BODY}\n\nthen edited`;
  await first.locator('.dh-editor-text').fill(edited);
  await first.locator('[data-dh-comment="save"]').dispatchEvent('click');
  await page.waitForTimeout(8000);

  const shows = (await mine().locator('.dh-comment', { hasText: 'then edited' }).count()) > 0;
  if (!shows) {
    answered.stop();
    console.log('      the edit did not show', JSON.stringify(answered.seen));
    return false;
  }

  const reply = mine().locator('.dh-comment', { hasText: replied });
  if ((await reply.count()) > 0) await deleteComment(reply.first());
  await deleteComment(mine().locator('.dh-comment', { hasText: 'then edited' }).first());
  answered.stop();

  const gone = (await frame.locator('.dh-thread', { hasText: written }).count()) === 0;
  const edits = answered.seen.some((one) => one === 'PUT 200');
  const deletes = answered.seen.filter((one) => /^DELETE 20[04]$/.test(one)).length;
  if (!gone || !edits || deletes === 0) {
    console.log(`      gone ${gone}, GitHub answered ${JSON.stringify(answered.seen)}`);
    return false;
  }
  return answered.seen.join(', ');
});

/**
 * Whatever a failed check above left behind, this run's or an earlier one's,
 * so the fixture starts the next run with nothing on it. Working from the
 * bottom up deletes each reply before the comment it answers
 */
const sweep = async () => {
  await frame.locator('[data-item-type="file"]').last().click();
  await page.waitForTimeout(4000);
  let removed = 0;
  for (let round = 0; round < 20; round += 1) {
    const left = frame.locator('.dh-comment', { hasText: TEST_TEXT });
    const count = await left.count();
    if (count === 0) break;
    const last = left.nth(count - 1);
    if ((await last.locator('[data-dh-comment="delete"]').count()) === 0) break;
    await deleteComment(last);
    removed += 1;
  }
  return removed;
};

const swept = await sweep().catch(() => 0);
if (swept > 0) console.log(`deleted ${swept} comment(s) a failed check left on the fixture`);

// Submits a real review on the fixture pull request, which is what it is for
failures += await check('a review can be submitted', async () => {
  const sent = [];
  page.on('response', (r) => {
    if (r.url().includes('submit_review')) sent.push(r.status());
  });

  await frame.locator('[data-dh-action="review"]').click();
  await page.waitForTimeout(1500);
  if ((await frame.locator('.dh-review').count()) === 0) {
    console.log('      the dialog did not open');
    return false;
  }
  await frame
    .locator('.dh-review-panel .dh-editor-text')
    .fill(`Submitted by the browser test at ${new Date().toISOString()}`);
  await frame.locator('.dh-review-send').click();
  await page.waitForTimeout(8000);

  const shown = await frame
    .locator('.dh-review-error')
    .textContent()
    .catch(() => null);
  if (shown != null) {
    console.log('      ', shown);
    return false;
  }
  if (!sent.includes(200)) {
    console.log('      GitHub answered', JSON.stringify(sent));
    return false;
  }
  if ((await frame.locator('.dh-review').count()) !== 0) {
    console.log('      the dialog stayed open');
    return false;
  }
  return 'submitted, and the dialog closed';
});

failures += await check('viewed state reaches GitHub', async () => {
  const before = reviewed.length;
  await frame.locator(`[data-dh-viewed="${marked}"]`).click();
  await page.waitForTimeout(3000);
  const sent = reviewed.slice(before);
  if (sent.length === 0) return false;
  const bad = sent.find((entry) => entry.status !== 200);
  if (bad != null) {
    console.log(`      GitHub answered ${bad.status}`);
    return false;
  }
  return `${sent[0].path} accepted`;
});

failures += await check('the tick survives', async () => {
  // Marking moves on to the next file, so that header is scrolled away and
  // recycled. The tally in the header is the durable evidence: a write GitHub
  // refused would have taken the tick back
  const text = (await frame.locator('.dh-stats span').first().textContent())?.trim() ?? '';
  const viewed = Number(text.split('/')[0].replace(/[^0-9]/g, ''));
  if (viewed < 1) console.log('      tally:', JSON.stringify(text), 'writes:', JSON.stringify(reviewed));
  return viewed >= 1 ? `${text} after the write` : false;
});

failures += await check('the tree marks it', async () => {
  const mark = frame.locator('[data-item-section="decoration"]', { hasText: '\u2713' }).first();
  await mark.waitFor({ timeout: 10000 }).catch(() => {});
  const marks = await frame.locator('[data-item-section="decoration"]', { hasText: '\u2713' }).count();
  return marks > 0 ? `${marks} mark(s)` : false;
});

await page.screenshot({ path: path.join(shots, 'comments.png') });

// Leave the pull request as we found it
const touched = [...new Set(reviewed.map((entry) => entry.path).filter(Boolean))];
if (touched.length > 0) {
  const cleaned = await page.evaluate(
    async ({ paths, endpoint }) => {
      const results = [];
      for (const filePath of paths) {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            'github-verified-fetch': 'true',
          },
          body: JSON.stringify({ path: filePath, viewed: 'unviewed' }),
        });
        results.push(res.status);
      }
      return results;
    },
    { paths: touched, endpoint: `${new URL(url).pathname}/file_review` },
  );
  console.log(`unmarked ${touched.length} file(s) on GitHub: ${cleaned.join(', ')}`);
}
console.log(`\nscreenshot: ${path.join(shots, 'comments.png')}`);
await context.close();
process.exit(failures === 0 ? 0 : 1);
