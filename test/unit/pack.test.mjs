import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pack, unpack } from '../../src/viewer/net/pack.ts';

// Well past the size where one `String.fromCharCode` spread would throw, which
// the browser suite's pull request never reaches
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
