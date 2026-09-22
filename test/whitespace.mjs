import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processFile } from '@pierre/diffs';
import { changesOnlyWhitespace } from '../src/patch/whitespace.ts';

// Real `git diff` output is the input: the patches are not hand-written, so a
// change in how git emits hunks shows up here rather than in the browser.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-whitespace-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 't@t');
git('config', 'user.name', 't');

const lines = (...values) => values.join('\n') + '\n';

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
  ['a real change', false, lines('const x = 1;', 'const y = 2;'), lines('const x = 1;', 'const y = 3;')],
  [
    'a real change with reindenting',
    false,
    lines('function a() {', '  return 1;', '}'),
    lines('function a() {', '    return 2;', '}'),
  ],
  ['a line added', false, lines('one', 'two'), lines('one', 'two', 'three')],
  ['spacing inside a line', true, lines('call( a , b )'), lines('call(a, b)')],
];

let failures = 0;
for (const [name, expected, before, after] of cases) {
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, before);
  git('add', '.');
  git('commit', '-q', '-m', 'a', '--allow-empty');
  fs.writeFileSync(file, after);
  git('add', '.');
  git('commit', '-q', '-m', 'b', '--allow-empty');

  const patch = git('diff', 'HEAD~1', 'HEAD', '--', 'f.txt');
  const fileDiff = processFile(patch, { isGitDiff: true, cacheKey: name });
  if (fileDiff == null) {
    console.log(`FAIL ${name}: processFile returned nothing`);
    failures += 1;
    continue;
  }

  const actual = changesOnlyWhitespace(fileDiff);
  if (actual === expected) {
    console.log(`ok   ${name} — ${actual ? 'spacing only' : 'a real change'}`);
  } else {
    console.log(`FAIL ${name}: expected ${expected}, got ${actual}`);
    failures += 1;
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
