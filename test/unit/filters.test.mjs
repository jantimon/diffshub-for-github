import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileFilters } from '../../src/patch/filters.ts';

const plain = { caseSensitive: false, regex: false };
const visible = (include, exclude, paths, options = {}) => {
  const filter = compileFilters(include, exclude, {
    include: { ...plain, ...options.include },
    exclude: { ...plain, ...options.exclude },
  });
  return paths.filter(filter.isVisible);
};

const paths = ['src/ConfigFile.ts', 'src/app.test.ts', 'src/deep/util.ts', 'docs/readme.md', 'package.json'];

test('no pattern shows everything', () => {
  assert.deepEqual(visible('', '', paths), paths);
});

test('a plain word matches anywhere in the path, ignoring case', () => {
  assert.deepEqual(visible('config', '', paths), ['src/ConfigFile.ts']);
});

test('case can be made to count', () => {
  assert.deepEqual(visible('config', '', paths, { include: { caseSensitive: true } }), []);
});

test('a pattern written like a glob stays a glob', () => {
  assert.deepEqual(visible('src/**', '', paths), [
    'src/ConfigFile.ts',
    'src/app.test.ts',
    'src/deep/util.ts',
  ]);
});

test('a bare glob matches in any folder', () => {
  assert.deepEqual(visible('*.test.*', '', paths), ['src/app.test.ts']);
});

test('exclude hides what matches', () => {
  assert.deepEqual(visible('', '*.test.*, docs/**', paths), [
    'src/ConfigFile.ts',
    'src/deep/util.ts',
    'package.json',
  ]);
});

test('commas and newlines both separate patterns, and a word and a glob mix', () => {
  assert.deepEqual(visible('readme\n*.json', '', paths), ['docs/readme.md', 'package.json']);
});

test('regular expressions', () => {
  assert.deepEqual(visible('^src/.*util', '', paths, { include: { regex: true } }), ['src/deep/util.ts']);
});

test('an unusable pattern is reported and ignored rather than hiding everything', () => {
  const filter = compileFilters('(', '', { include: { caseSensitive: false, regex: true }, exclude: plain });
  assert.ok(filter.includeError != null);
  assert.deepEqual(paths.filter(filter.isVisible), paths);
});
