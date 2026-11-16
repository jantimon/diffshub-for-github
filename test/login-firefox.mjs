import { firefox } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sign in once, outside any container. Playwright's Firefox may refuse a
// profile it did not make, so the suite uses this one

const root = path.dirname(fileURLToPath(import.meta.url));
const profile = process.env.DIFFSHUB_FIREFOX_PROFILE ?? path.resolve(root, '.firefox-profile');

const context = await firefox.launchPersistentContext(profile, { headless: false, viewport: null });
const page = context.pages()[0] ?? (await context.newPage());

await page.goto('https://github.com/login');
console.log('Sign in, then close the browser window to save the session.');
await context.waitForEvent('close', { timeout: 0 });
