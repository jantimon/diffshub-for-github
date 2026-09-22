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
  },
);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(12000);

let frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));
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

// Marking a file viewed is a real write; remember what to put back
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
failures += await check('a comment renders as GitHub renders it', async () => {
  const bodies = await frame.locator('.dh-comment-body').count();
  if (bodies === 0) {
    console.log('      no rendered bodies');
    return false;
  }
  const html = await frame.locator('.dh-comment-body').first().innerHTML();
  return html.includes('<') ? `${bodies} rendered` : false;
});

failures += await check('thread sits inside the diff', async () => {
  const inside = await frame.evaluate(() => {
    const thread = document.querySelector('.dh-thread');
    return thread != null && thread.closest('.dh-code') != null;
  });
  return inside && 'anchored in the viewer';
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
frame = page.frames().find((f) => f.url().startsWith('chrome-extension://'));

// The patch streams and the comments arrive in two paginated walks; the write
// checks below are about state, so let the overlay settle before touching it
await frame
  .locator('.dh-loading')
  .waitFor({ state: 'detached', timeout: 30000 })
  .catch(() => {});
await frame.locator('[data-dh-viewed]').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);

const marked = await frame.locator('[data-dh-viewed]').first().getAttribute('data-dh-viewed');

// Leaves a real comment on the fixture pull request, which is what it is for
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

failures += await check('a comment can be written', async () => {
  const posted = [];
  page.on('response', (r) => {
    if (r.url().includes('create_review_comment')) posted.push(r.status());
  });

  const before = await frame.locator('.dh-thread').count();

  // Go to the last file: the first one collects a thread on every run
  await frame.locator('[data-item-type="file"]').last().click();
  await page.waitForTimeout(2000);

  const line = frame.locator('[data-line]').last();
  await line.scrollIntoViewIfNeeded();
  await line.hover();
  await page.waitForTimeout(900);
  const box = await frame.locator('[data-utility-button]').first().boundingBox();
  if (box == null) {
    console.log('      no gutter control appeared');
    return false;
  }
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  if ((await frame.locator('.dh-composer').count()) === 0) {
    console.log('      the composer did not open');
    return false;
  }

  await frame
    .locator('.dh-composer .dh-editor-text')
    .fill(`Written by the browser test at ${new Date().toISOString()}`);
  await frame.locator('.dh-composer-send').click();
  await page.waitForTimeout(9000);

  // The thread lands on whichever file was open, which the viewer may have
  // scrolled away from, so the count on screen proves nothing
  if (!posted.includes(200)) {
    console.log('      GitHub answered', JSON.stringify(posted));
    return false;
  }
  if ((await frame.locator('.dh-composer').count()) !== 0) {
    console.log('      the box stayed open');
    return false;
  }
  return `posted, and the box closed (${before} threads were on screen)`;
});

// The check above posts on the last file and leaves the viewer there. Threads
// collect on the first file, so the checks that act on one go back and wait for
// it to render rather than hoping something is still on screen
const showAThread = async () => {
  await frame.locator('[data-item-type="file"]').first().click();
  await page.waitForTimeout(2500);
  await frame.locator('.dh-thread').first().waitFor({ timeout: 25000 });
};

failures += await check('a comment can be replied to', async () => {
  const sent = [];
  page.on('response', (r) => {
    if (r.url().includes('review_comment/create')) sent.push(r.status());
  });

  await showAThread();

  /**
   * Every step stays inside one thread: the new-comment composer shares these
   * class names, so picking `.first()` per selector can land on two different
   * conversations once enough of them are on screen
   *
   * The thread is pinned by position rather than by "the one with a reply
   * button", because clicking that button swaps it for the composer, and a
   * filter on it stops matching the moment it is used
   */
  const threads = frame.locator('.dh-thread');
  let index = -1;
  for (let i = 0; i < (await threads.count()); i += 1) {
    if ((await threads.nth(i).locator('[data-dh-thread="reply"]').count()) > 0) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    console.log('      no thread offered a reply button');
    return false;
  }

  const thread = threads.nth(index);
  await thread.locator('[data-dh-thread="reply"]').click({ timeout: 10000 });
  await thread.locator('.dh-editor-text').fill(`Replied by the browser test at ${new Date().toISOString()}`);
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
    console.log('      the send button never became usable');
    return false;
  }
  // Dispatched rather than clicked: a forced click still lands wherever the
  // pointer is, and the virtualiser moves rows under it
  await send.dispatchEvent('click');
  await page.waitForTimeout(9000);

  const shown = await frame.locator('.dh-thread-error').allTextContents();
  if (shown.length > 0) {
    console.log('      ', shown.join(' | '));
    return false;
  }
  if (!sent.includes(200)) {
    console.log('      GitHub answered', JSON.stringify(sent));
    return false;
  }
  return "posted through GitHub's own reply form";
});

failures += await check('any conversation can be resolved', async () => {
  const sent = [];
  page.on('response', (r) => {
    if (/page_data\/(un)?resolve_thread$/.test(r.url()))
      sent.push(`${r.status()} ${r.url().split('/').pop()}`);
  });

  await showAThread();

  // Resolving goes through a JSON route that takes the thread id, so it no
  // longer depends on GitHub having rendered a form for that conversation
  // Taking the first button on screen is therefore a fair test of all of them
  const button = frame.locator('[data-dh-thread="resolve"]').first();
  if ((await button.count()) === 0) return false;
  const wasResolved = (await button.textContent())?.includes('Reopen') === true;

  await button.click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  if (!sent.some((entry) => entry.startsWith('200'))) {
    console.log(`      requests: ${sent.join(', ') || 'none'}`);
    return false;
  }

  // Put it back the way it was found
  const back = frame.locator('[data-dh-thread="resolve"]').first();
  if (await back.isVisible().catch(() => false)) {
    await back.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(5000);
  }
  return `${wasResolved ? 'reopened' : 'resolved'} through ${sent[0]?.split(' ')[1]}, then restored`;
});

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
