import assert from 'node:assert/strict';
import { test } from 'node:test';

import { streamPatchFiles } from '../../src/patch/stream.ts';

const patch = [
  'diff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-a\n+b\n',
  'diff --git a/two.ts b/two.ts\n--- a/two.ts\n+++ b/two.ts\n@@ -1 +1 @@\n-c\n+d\n',
  'diff --git a/three.ts b/three.ts\n--- a/three.ts\n+++ b/three.ts\n@@ -1 +1 @@\n-e\n+f\n',
].join('');

/** The patch as a stream of chunks cut at the given offsets */
function chunked(text, cuts) {
  const bytes = new TextEncoder().encode(text);
  const edges = [0, ...cuts, bytes.length];
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < edges.length - 1; at += 1)
        controller.enqueue(bytes.slice(edges[at], edges[at + 1]));
      controller.close();
    },
  });
}

async function files(stream, signal) {
  const out = [];
  await streamPatchFiles(stream, (file) => out.push(file), signal);
  return out;
}

test('splits a patch into whole files', async () => {
  const out = await files(chunked(patch, []));
  assert.equal(out.length, 3);
  assert.equal(out.join(''), patch);
  assert.ok(out.every((file) => file.startsWith('diff --git ')));
});

// The boundary is searched across chunks, so a header split anywhere still counts
test('a file boundary split across two chunks at any point', async () => {
  const second = patch.indexOf('\ndiff --git a/two.ts');
  for (let cut = second - 2; cut <= second + 14; cut += 1) {
    const out = await files(chunked(patch, [cut]));
    assert.equal(out.length, 3, `cut at ${cut}`);
    assert.equal(out.join(''), patch);
  }
});

test('a stream cut into single bytes', async () => {
  const cuts = Array.from({ length: new TextEncoder().encode(patch).length - 1 }, (_, at) => at + 1);
  assert.equal((await files(chunked(patch, cuts))).join(''), patch);
});

test('stops when the signal is aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const out = [];
  await streamPatchFiles(chunked(patch, [10, 20]), (file) => out.push(file), controller.signal);
  assert.ok(out.length < 3);
});

test('an empty patch has no files', async () => {
  assert.deepEqual(await files(chunked('', [])), []);
});
