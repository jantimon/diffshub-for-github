import { launch, openOverlay } from './browser.mjs';
for (let run = 0; run < 3; run += 1) {
  const { context, page } = await launch({ har: true });
  const seen = [];
  let refused = 0;
  await context.route(/\/pull\/\d+\.diff$/, (route) => {
    if (refused > 0) return route.fallback();
    refused += 1;
    return route.fulfill({ status: 503, body: 'refused by the test' });
  });
  context.on('response', (r) => {
    if (/\.diff|patch-diff/.test(r.url())) seen.push(`${r.status()} ${r.url().slice(-50)}`);
  });
  const frame = await openOverlay(page, 'https://github.com/microsoft/TypeScript/pull/64204');
  const phase = await frame?.locator('.dh-overlay').getAttribute('data-dh-phase');
  const files = await frame?.locator('[data-item-type="file"]').count();
  const toasts = await frame?.locator('.dh-toast').allTextContents();
  console.log(
    `run ${run}: phase ${phase}, files ${files}, toasts ${JSON.stringify(toasts)}, diff responses ${JSON.stringify(seen)}`,
  );
  await context.close();
}
