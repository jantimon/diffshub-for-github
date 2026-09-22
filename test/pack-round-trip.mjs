/**
 * Proves a patch of any size survives being packed and unpacked.
 *
 * The size is the point. Base64 is built by handing bytes to
 * `String.fromCharCode` as arguments, and too many at once throws `RangeError`
 * -- which the cache treats as "not worth keeping" and swallows. So the failure
 * is a cache that silently stops working above a size, and the only way to
 * notice is to pack something big on purpose.
 *
 * Offline. Node has `CompressionStream`, `Blob`, `btoa` and `atob`.
 */

import { pack, unpack } from '../src/viewer/files/pack.ts';
import { LIMITS } from '../src/viewer/files/responseCache.ts';

let failures = 0;

const check = (name, value) => {
  if (value === true) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}`);
};

/** Patch-shaped text, so the compression ratio is the real one */
function patch(lines) {
  const out = [];
  for (let at = 0; at < lines; at += 1) {
    if (at % 40 === 0) out.push(`diff --git a/src/file${at}.ts b/src/file${at}.ts`);
    out.push(`+  const value${at} = compute(${at}, 'some ordinary looking argument');`);
    out.push(`-  const value${at} = computeOld(${at}, 'some ordinary looking argument');`);
  }
  return out.join('\n');
}

const read = async (stream) => await new Response(stream).text();

for (const lines of [10, 5_000, 60_000, 200_000]) {
  const text = patch(lines);
  const packed = await pack(text, LIMITS.maxRawChars);
  if (packed == null) {
    check(`${Math.round(text.length / 1024)} KB of patch packs`, false);
    continue;
  }
  const back = await read(unpack(packed));
  check(
    `${Math.round(text.length / 1024)} KB of patch survives the round trip (${(text.length / packed.length).toFixed(1)}x)`,
    back === text,
  );
}

// The character that makes a string two bytes apiece, in case anyone assumes ASCII
const wide = `diff --git a/a b/a\n+ ${'🙂 über naïve ünicode'.repeat(20_000)}`;
const packedWide = await pack(wide, LIMITS.maxRawChars);
check(
  'a patch full of characters outside latin-1 survives',
  packedWide != null && (await read(unpack(packedWide))) === wide,
);

check(
  'something implausibly large is refused rather than thrown',
  (await pack('x'.repeat(60_000_000), LIMITS.maxRawChars)) === undefined,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
