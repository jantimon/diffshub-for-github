/**
 * Proves a large patch survives being packed and unpacked.
 *
 * Base64 is built by handing bytes to `String.fromCharCode` as arguments, and
 * too many at once throws `RangeError`, which the cache swallows as "not worth
 * keeping". The browser suite cannot see it: its pull request gzips to about
 * 100 KB, under the point where the spread breaks. This one is well over.
 *
 * Offline. Node has `CompressionStream`, `Blob`, `btoa` and `atob`.
 */

import { pack, unpack } from '../src/viewer/net/pack.ts';

const lines = [];
for (let at = 0; at < 200_000; at += 1) {
  if (at % 40 === 0) lines.push(`diff --git a/src/file${at}.ts b/src/file${at}.ts`);
  lines.push(`+  const value${at} = compute(${at}, 'some ordinary looking argument');`);
  lines.push(`-  const value${at} = computeOld(${at}, 'some ordinary looking argument');`);
}
const text = lines.join('\n');

const packed = await pack([new TextEncoder().encode(text)]);
const back = packed == null ? undefined : await new Response(unpack(packed)).text();

if (back !== text) {
  console.log(`FAIL ${Math.round(text.length / 1024)} KB of patch did not survive the round trip`);
  process.exit(1);
}
console.log(`ok   ${Math.round(text.length / 1024)} KB of patch survives the round trip`);
