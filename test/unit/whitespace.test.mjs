import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processFile } from '@pierre/diffs';

import { changesOnlyWhitespace } from '../../src/patch/whitespace.ts';
import { gitDiff, lines } from './gitDiff.mjs';

const cases = [
  [
    'reindented',
    true,
    lines('function a() {', '  return 1;', '}'),
    lines('function a() {', '    return 1;', '}'),
  ],
  [
    'trailing spaces added',
    true,
    lines('const x = 1;', 'const y = 2;'),
    lines('const x = 1;   ', 'const y = 2;  '),
  ],
  ['tabs to spaces', true, lines('if (a) {', '\treturn b;', '}'), lines('if (a) {', '    return b;', '}')],
  ['spacing inside a line', true, lines('call( a , b )'), lines('call(a, b)')],
  ['a real change', false, lines('const x = 1;', 'const y = 2;'), lines('const x = 1;', 'const y = 3;')],
  [
    'a real change with reindenting',
    false,
    lines('function a() {', '  return 1;', '}'),
    lines('function a() {', '    return 2;', '}'),
  ],
  ['a line added', false, lines('one', 'two'), lines('one', 'two', 'three')],
];

for (const [name, spacingOnly, before, after] of cases) {
  test(`${name}: ${spacingOnly ? 'spacing only' : 'a real change'}`, () => {
    const fileDiff = processFile(gitDiff(before, after), { isGitDiff: true, cacheKey: name });
    assert.ok(fileDiff != null, 'processFile returned nothing');
    assert.equal(changesOnlyWhitespace(fileDiff), spacingOnly);
  });
}
