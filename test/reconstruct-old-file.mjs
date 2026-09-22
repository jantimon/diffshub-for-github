import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { processFile } from '@pierre/diffs';
import { reconstructOldFile } from '../src/patch/reconstructOldFile.ts';

// Real `git diff` output is the input: the patches are not hand-written, so a
// change in how git emits hunks shows up here rather than in the browser
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-reconstruct-'));
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 't@t');
git('config', 'user.name', 't');

const cases = {
  'middle-change': [
    Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n',
    Array.from({ length: 40 }, (_, i) => (i === 20 ? 'CHANGED' : `line ${i}`)).join('\n') + '\n',
  ],
  'two-hunks': [
    Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n') + '\n',
    Array.from({ length: 60 }, (_, i) => (i === 5 || i === 50 ? `x${i}` : `line ${i}`)).join('\n') + '\n',
  ],
  'insert-at-top': [
    Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n',
    'brand new\n' + Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n',
  ],
  'delete-at-end': [
    Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n',
    Array.from({ length: 27 }, (_, i) => `line ${i}`).join('\n') + '\n',
  ],
  'no-trailing-newline': [
    Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
    Array.from({ length: 20 }, (_, i) => (i === 10 ? 'C' : `line ${i}`)).join('\n'),
  ],
  'grow-and-shrink': [
    Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n',
    Array.from({ length: 50 }, (_, i) => (i === 10 ? 'a\nb\nc' : i === 30 ? null : `line ${i}`))
      .filter((v) => v !== null)
      .join('\n') + '\n',
  ],
};

let failures = 0;
for (const [name, [oldText, newText]] of Object.entries(cases)) {
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, oldText);
  git('add', '.');
  git('commit', '-q', '-m', 'a', '--allow-empty');
  fs.writeFileSync(file, newText);
  git('add', '.');
  git('commit', '-q', '-m', 'b', '--allow-empty');
  const patch = git('diff', 'HEAD~1', 'HEAD', '--', 'f.txt');
  const fileDiff = processFile(patch, { isGitDiff: true, cacheKey: name });
  if (fileDiff == null) {
    console.log(`FAIL ${name}: processFile returned nothing`);
    failures++;
    continue;
  }
  const rebuilt = reconstructOldFile(fileDiff, newText);
  if (rebuilt === oldText) {
    console.log(`ok   ${name}`);
    continue;
  }
  failures++;
  console.log(`FAIL ${name}`);
  const a = oldText.split('\n');
  const b = rebuilt.split('\n');
  console.log(`     expected ${a.length} lines, got ${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log(`     first diff at ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`);
      break;
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
