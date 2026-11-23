import { firefox } from '@playwright/test';
import {
  MODE,
  checker,
  clickMarker,
  refuseSignedInRecording,
  refuseToRecordWhileRefused,
  requireRecording,
  routeFromRecording,
  stopOnRefusal,
} from './browser.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Two runs in one file. Replayed, the default, it is signed out against a
 * recording of a public pull request, and proves the Firefox build loads,
 * marks the tab and renders a patch: what CI can check. Live, signed in, it
 * also proves the signed address that a private pull request needs, in the
 * default container and in a container tab, which no recording can show
 */

// web-ext does not export this, but it is the client `web-ext run` itself uses
// to install a temporary add-on over the remote debugging protocol. Playwright
// has no way to load an extension into Firefox without it
const { connect } = await import(
  pathToFileURL(path.resolve('node_modules/web-ext/lib/firefox/remote.js')).href
);

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/firefox-mv3');
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/1';
const PORT = 6794;
/** The container check starts a second browser, which needs its own port */
const CONTAINER_PORT = 6796;

// Playwright's Firefox profile ships cookieBehavior 4, which is Total Cookie
// Protection turned off. Firefox itself defaults to 5. Testing on 4 makes the
// signed address look unnecessary, so pin the real default here
const COOKIE_BEHAVIOUR = 5;

const live = MODE === 'live';
const headless = process.env.DIFFSHUB_HEADED !== '1';

const profile = live
  ? (process.env.DIFFSHUB_FIREFOX_PROFILE ?? path.resolve(root, '.firefox-profile'))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-firefox-har-'));
if (live && !fs.existsSync(path.join(profile, 'cookies.sqlite'))) {
  console.log('The live run needs a Firefox profile signed in to github.com.');
  console.log('Run `pnpm test:login:firefox` once, or point DIFFSHUB_FIREFOX_PROFILE at one.');
  process.exit(2);
}
if (!live) requireRecording('firefox');
await refuseToRecordWhileRefused(url);

const context = await firefox.launchPersistentContext(profile, {
  headless,
  viewport: { width: 1500, height: 950 },
  args: ['-start-debugger-server', String(PORT)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'network.cookie.cookieBehavior': COOKIE_BEHAVIOUR,
  },
});

/** Installs the build over web-ext's RDP client, or ends the run */
async function installAddon(port, closeable) {
  let client;
  for (let attempt = 0; attempt < 40 && client == null; attempt += 1) {
    try {
      client = await connect(port);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (client == null) {
    console.log('FAIL: the debugger server never came up');
    await closeable.close();
    process.exit(1);
  }
  await client.installTemporaryAddon(dist);
}

/** Opens the pull request, clicks the marked tab, and returns the viewer's frame */
async function openViewer(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await clickMarker(page);
  await page.waitForTimeout(14000);
  return page.frames().find((f) => f.url().startsWith('moz-extension://'));
}

async function patchFiles(frame) {
  const text = (await frame.locator('.dh-stats span').first().textContent())?.trim() ?? '';
  const files = Number(text.split('/')[1]?.replace(/[^0-9]/g, '') ?? '0');
  return files > 0 ? text : false;
}

await installAddon(PORT, context);
if (!live) await routeFromRecording(context, 'firefox');

/**
 * The background reads the patch's address from GitHub's redirect with
 * `webRequest`, and an answer Playwright serves from the recording never
 * reaches Firefox's network layer, so `webRequest` would see nothing. That one
 * request goes to github.com, a single small public redirect per run, and the
 * patch it points at comes from the recording. Routes added later run first
 */
if (MODE === 'replay')
  await context.route(/github\.com\/[^/]+\/[^/]+\/pull\/\d+\.diff$/, (route) => route.continue());

const page = context.pages()[0] ?? (await context.newPage());
if (!live) stopOnRefusal(context, page);
const { check, finish } = checker();

await page.goto(url, { waitUntil: 'domcontentloaded' });
await refuseSignedInRecording(context, page);
if (live) {
  await check('signed in', async () => {
    const who = await page.evaluate(
      () => document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? null,
    );
    return who ?? false;
  });
}
await check('the tab is marked', async () => (await page.locator('[data-diffshub-marked]').count()) > 0);

const frame = await openViewer(page);
if (frame == null) {
  console.log('FAIL  the overlay opens');
  await context.close();
  process.exit(1);
}

await check(live ? 'a private patch renders' : 'the patch renders', () => patchFiles(frame));

fs.mkdirSync(path.resolve(root, 'screenshots'), { recursive: true });
if (!live) {
  await page.screenshot({ path: path.resolve(root, 'screenshots', 'firefox.png') });
  await finish(context);
}

// The reason the signed address exists. If this ever succeeds, Firefox has
// changed and the viewer can fetch for itself
await check('the viewer alone cannot reach a private patch', async () => {
  const result = await frame.evaluate(async (target) => {
    const response = await fetch(target, { credentials: 'include' });
    return response.status;
  }, `${url}.diff`);
  return result === 404 ? `direct fetch answers ${result}, as expected` : false;
});

await page.screenshot({ path: path.resolve(root, 'screenshots', 'firefox.png') });

/**
 * In the default container the background is signed in too, so the check above
 * cannot tell who downloaded. Playwright runs each Firefox `newContext` as a
 * container, so only that context gets the session.
 */
const session = await context.storageState();
await context.close();

const browser = await firefox.launch({
  headless,
  args: ['-start-debugger-server', String(CONTAINER_PORT)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'network.cookie.cookieBehavior': COOKIE_BEHAVIOUR,
  },
});
await installAddon(CONTAINER_PORT, browser);
const container = await browser.newContext({
  storageState: session,
  viewport: { width: 1500, height: 950 },
});
const containerPage = await container.newPage();
const containerFrame = await openViewer(containerPage);

await check('a private patch renders in a container tab', async () =>
  containerFrame == null ? false : patchFiles(containerFrame),
);

await containerPage.screenshot({ path: path.resolve(root, 'screenshots', 'firefox-container.png') });
await finish(browser);
