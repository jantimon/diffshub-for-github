/**
 * Proves the kept copies stay bounded and never outlive their commit.
 *
 * The store itself needs a browser, but the part worth proving does not: what
 * to keep and what to let go is a pure decision, and a cache that quietly grows
 * through a long browsing session is the failure this guards against.
 *
 * Offline. It builds an index by hand rather than filling a real one.
 */

import { cacheKey, LIMITS, planEviction, WEB_LIMITS } from '../src/viewer/files/responseCache.ts';

let failures = 0;

const check = (name, value) => {
  if (value === true) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}`);
};

const limits = { maxEntries: 3, maxEntryChars: 1000, maxTotalChars: 2000, maxRawChars: 9999 };
const entry = (key, chars, usedAt) => ({ key, chars, usedAt });

check(
  'a different commit is a different key',
  cacheKey('a'.repeat(40), 'https://example/x.diff') !== cacheKey('b'.repeat(40), 'https://example/x.diff'),
);

check(
  'a different address is a different key',
  cacheKey('a'.repeat(40), 'https://example/x.diff') !== cacheKey('a'.repeat(40), 'https://example/y.diff'),
);

{
  const plan = planEviction([], entry('one', 100, 1), limits);
  check('the first answer is kept', plan?.keep.length === 1 && plan.evict.length === 0);
}

{
  const full = [entry('a', 100, 1), entry('b', 100, 2), entry('c', 100, 3)];
  const plan = planEviction(full, entry('d', 100, 4), limits);
  check(
    'a full cache lets the least recently read one go',
    plan?.evict.length === 1 && plan.evict[0] === 'a' && plan.keep.length === 3,
  );
  check('and keeps the rest in order', plan?.keep.map((e) => e.key).join(',') === 'b,c,d');
}

{
  // `usedAt` out of order, because storage hands back whatever it was given
  const shuffled = [entry('c', 100, 30), entry('a', 100, 10), entry('b', 100, 20)];
  const plan = planEviction(shuffled, entry('d', 100, 40), limits);
  check('age decides, not the order it was stored in', plan?.evict[0] === 'a');
}

{
  const plan = planEviction([entry('a', 900, 1), entry('b', 900, 2)], entry('c', 900, 3), limits);
  check(
    'the total cap evicts even when there is room to count',
    plan != null && plan.evict.length >= 1 && plan.keep.reduce((n, e) => n + e.chars, 0) <= 2000,
  );
}

{
  const plan = planEviction([entry('a', 100, 1)], entry('big', 1001, 2), limits);
  check('an answer too big to keep is refused outright', plan === undefined);
}

{
  const before = [entry('a', 100, 1), entry('b', 100, 2)];
  const plan = planEviction(before, entry('a', 150, 9), limits);
  check(
    'writing a key again moves it rather than doubling it',
    plan?.keep.length === 2 && plan.keep.at(-1)?.key === 'a' && plan.evict.length === 0,
  );
}

check(
  'the shipped per-entry cap is under the total, so eviction always terminates',
  LIMITS.maxEntryChars < LIMITS.maxTotalChars,
);

/**
 * Measured, not assumed: `storage.session.QUOTA_BYTES` reports 10,485,760 and
 * enforces it, refusing a 10 MB value outright while a 9 MB one stores and
 * reads back. The budget has to leave room for the index beside the bodies.
 */
check('the shipped total stays under the quota the browser enforces', LIMITS.maxTotalChars < 10_485_760);

/**
 * The page's own session storage is not part of that quota system at all. Web
 * storage has its own hard ceiling of 5 MiB an origin, so the fallback tier has
 * to be budgeted against a different and smaller number.
 */
check(
  'the fallback tier stays under the 5 MiB web storage allows',
  WEB_LIMITS.maxTotalChars < 5 * 1024 * 1024 && WEB_LIMITS.maxEntryChars < WEB_LIMITS.maxTotalChars,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
