import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Opens the profile the tests use so you can sign in to github.com once. The
// session is kept in test/.profile, which is gitignored.
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../.output/chrome-mv3');

const context = await chromium.launchPersistentContext(
  process.env.DIFFSHUB_PROFILE ?? path.resolve(root, '.profile'),
  {
    channel: 'chromium',
    headless: false,
    viewport: null,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  },
);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://github.com/login');
console.log('Sign in, then close the browser window to save the session.');
await context.waitForEvent('close', { timeout: 0 });
