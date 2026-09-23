import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pack, unpack } from '../../src/viewer/net/pack.ts';

/**
 * Base64 is built by handing bytes to `String.fromCharCode` as arguments, and
 * too many at once throws `RangeError`, which the cache swallows as "not worth
 * keeping". The browser suite cannot see it: its pull request gzips to about
 * 100 KB, under the point where the spread breaks. This one is well over.
 */
test('a large patch survives being packed and unpacked', async () => {
  const lines = [];
  for (let at = 0; at < 200_000; at += 1) {
    if (at % 40 === 0) lines.push(`diff --git a/src/file${at}.ts b/src/file${at}.ts`);
    lines.push(`+  const value${at} = compute(${at}, 'some ordinary looking argument');`);
    lines.push(`-  const value${at} = computeOld(${at}, 'some ordinary looking argument');`);
  }
  const text = lines.join('\n');
  const packed = await pack([new TextEncoder().encode(text)]);
  assert.ok(packed != null, 'nothing was packed');
  assert.equal(await new Response(unpack(packed)).text(), text);
});
