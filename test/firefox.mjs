import { firefox } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// web-ext does not export this, but it is the client `web-ext run` itself uses
// to install a temporary add-on over the remote debugging protocol. Playwright
// has no way to load an extension into Firefox without it.
const { connect } = await import(
  pathToFileURL(path.resolve('node_modules/web-ext/lib/firefox/remote.js')).href
);

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/firefox-mv3');
const url = process.argv[2] ?? 'https://github.com/jantimon/diffshub-for-github/pull/1';
const PORT = 6794;

// Playwright's Firefox profile ships cookieBehavior 4, which is Total Cookie
// Protection turned off. Firefox itself defaults to 5. Testing on 4 makes the
// background fetch proxy look unnecessary, so pin the real default here.
const COOKIE_BEHAVIOUR = 5;

const profile = process.env.DIFFSHUB_FIREFOX_PROFILE;
if (profile == null || !fs.existsSync(path.join(profile, 'cookies.sqlite'))) {
  console.log('This suite needs a Firefox profile signed in to github.com.');
  console.log('Point DIFFSHUB_FIREFOX_PROFILE at one; see README.');
  process.exit(2);
}

const context = await firefox.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1500, height: 950 },
  args: ['-start-debugger-server', String(PORT)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'network.cookie.cookieBehavior': COOKIE_BEHAVIOUR,
  },
});

let client;
for (let attempt = 0; attempt < 40 && client == null; attempt += 1) {
  try {
    client = await connect(PORT);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
if (client == null) {
  console.log('FAIL: the debugger server never came up');
  await context.close();
  process.exit(1);
}
await client.installTemporaryAddon(dist);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

let failures = 0;
const check = async (name, fn) => {
  try {
    const value = await fn();
    console.log(`${value ? 'ok  ' : 'FAIL'}  ${name}${value && value !== true ? ` — ${value}` : ''}`);
    if (!value) failures += 1;
  } catch (error) {
    console.log(`FAIL  ${name} — ${String(error).slice(0, 140)}`);
    failures += 1;
  }
};

await check('signed in', async () => {
  const who = await page.evaluate(
    () => document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? null,
  );
  return who ?? false;
});

await check('the tab is marked', async () => (await page.locator('[data-diffshub-marked]').count()) > 0);
await page.locator('[data-diffshub-marked]').first().click();
await page.waitForTimeout(14000);

const frame = page.frames().find((f) => f.url().startsWith('moz-extension://'));
if (frame == null) {
  console.log('FAIL  the overlay opens');
  await context.close();
  process.exit(1);
}

await check('a private patch renders', async () => {
  const text = (await frame.locator('.dh-stats span').first().textContent())?.trim() ?? '';
  const files = Number(text.split('/')[1]?.replace(/[^0-9]/g, '') ?? '0');
  return files > 0 ? text : false;
});

// The reason the background proxy exists. If this ever succeeds, Firefox has
// changed and the proxy can go.
await check('the viewer alone cannot reach a private patch', async () => {
  const result = await frame.evaluate(async (target) => {
    const response = await fetch(target, { credentials: 'include' });
    return response.status;
  }, `${url}.diff`);
  return result === 404 ? `direct fetch answers ${result}, as expected` : false;
});

await page.screenshot({ path: path.resolve(root, 'screenshots', 'firefox.png') });
await context.close();
process.exit(failures === 0 ? 0 : 1);
