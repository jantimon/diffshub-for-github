import { launch } from './browser.mjs';

// Opens the profile the tests use so you can sign in to github.com once. The
// session is kept in test/.profile, which is gitignored

const { context, page } = await launch({ viewport: null });

await page.goto('https://github.com/login');
console.log('Sign in, then close the browser window to save the session.');
await context.waitForEvent('close', { timeout: 0 });
