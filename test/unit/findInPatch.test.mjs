import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hydratePartialDiff, processFile } from '@pierre/diffs';

import { compileQuery, findInFiles } from '../../src/patch/findInPatch.ts';
import { gitDiff, numbered } from './gitDiff.mjs';

const plain = { caseSensitive: false, wholeWord: false, regex: false };

// Sixty lines with two changes: two hunks with a gap between them. Line numbers
// below are one-based, the way the diff shows them
const before = numbered(60, { 5: 'old needle', 7: 'context needle', 20: 'gap needle', 50: 'x' });
const after = numbered(60, { 5: 'new needle', 7: 'context needle', 20: 'gap needle', 50: 'y' });
const partial = processFile(gitDiff(before, after), { isGitDiff: true, cacheKey: 'find' });

const file = (fileDiff) => ({ item: { id: 'f', type: 'diff', fileDiff, version: 0 }, path: 'f.txt' });
const find = (query, fileDiff = partial, expansion, options = plain) =>
  findInFiles([file(fileDiff)], compileQuery(query, options).pattern, () => expansion).matches;

test('a removed line is found on the old side, an added one on the new, in that order', () => {
  const [removed, added] = find('needle').filter((match) => match.lineNumber === 6);
  assert.deepEqual([removed.side, added.side], ['deletions', 'additions']);
});

test('a context line is found once, on the new side', () => {
  const context = find('context needle');
  assert.equal(context.length, 1);
  assert.deepEqual([context[0].side, context[0].lineNumber], ['additions', 8]);
});

test('code in a collapsed gap is not searched', () => {
  assert.equal(find('gap needle').length, 0);
});

test('an opened gap is searched once the file is loaded, a closed one is not', () => {
  const loaded = hydratePartialDiff('clone', partial, {
    oldFile: { name: 'f.txt', contents: before },
    newFile: { name: 'f.txt', contents: after },
  });
  assert.equal(find('gap needle', loaded).length, 0, 'loaded but not opened');
  const opened = new Map([[1, { fromStart: 1000, fromEnd: 0 }]]);
  const found = find('gap needle', loaded, opened);
  assert.deepEqual(
    found.map((match) => [match.side, match.lineNumber]),
    [['additions', 21]],
  );
});

test('match case and whole word narrow what is found', () => {
  assert.equal(find('NEEDLE').length, 3);
  assert.equal(find('NEEDLE', partial, undefined, { ...plain, caseSensitive: true }).length, 0);
  assert.equal(find('need', partial, undefined, { ...plain, wholeWord: true }).length, 0);
});

test('text is searched as written unless regex is on', () => {
  assert.equal(find('ne.dle').length, 0);
  assert.equal(find('ne.dle', partial, undefined, { ...plain, regex: true }).length, 3);
});

test('an unusable pattern is reported, and an empty one searches nothing', () => {
  assert.ok(compileQuery('(', { ...plain, regex: true }).error != null);
  assert.deepEqual(compileQuery('', plain), {});
});

// `x*` also matches the empty string between every two characters. Those are
// stepped over, leaving the x in "context" and the removed line "x"
test('a pattern that can match nothing does not loop', () => {
  assert.equal(find('x*', partial, undefined, { ...plain, regex: true }).length, 2);
});
