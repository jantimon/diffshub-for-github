import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processFile } from '@pierre/diffs';

import { reconstructOldFile } from '../../src/patch/reconstructOldFile.ts';
import { gitDiff, numbered } from './gitDiff.mjs';

// The old side of a file is rebuilt from its new side and the patch, so
// expanding context needs no second download
const cases = {
  'a change in the middle': [numbered(40), numbered(40, { 20: 'CHANGED' })],
  'two hunks': [numbered(60), numbered(60, { 5: 'x5', 50: 'x50' })],
  'an insert at the top': [numbered(30), 'brand new\n' + numbered(30)],
  'lines deleted at the end': [numbered(30), numbered(27)],
  'no trailing newline': [numbered(20).slice(0, -1), numbered(20, { 10: 'C' }).slice(0, -1)],
  'lines grown and shrunk': [numbered(50), numbered(50, { 10: 'a\nb\nc', 30: null })],
};

for (const [name, [oldText, newText]] of Object.entries(cases)) {
  test(name, () => {
    const fileDiff = processFile(gitDiff(oldText, newText), { isGitDiff: true, cacheKey: name });
    assert.ok(fileDiff != null, 'processFile returned nothing');
    assert.equal(reconstructOldFile(fileDiff, newText), oldText);
  });
}
