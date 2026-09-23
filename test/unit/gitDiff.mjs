import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Real `git diff` output for a file that changed from `before` to `after`.
 *
 * The tests parse what git itself emits rather than hand-written patches, so a
 * change in how git writes hunks shows up here rather than in the browser.
 */
export function gitDiff(before, after, file = 'f.txt') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), before);
    git('add', '.');
    git('commit', '-q', '-m', 'before', '--allow-empty');
    fs.writeFileSync(path.join(dir, file), after);
    git('add', '.');
    git('commit', '-q', '-m', 'after', '--allow-empty');
    return git('diff', 'HEAD~1', 'HEAD', '--', file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Lines joined as a file holds them, with the final newline */
export const lines = (...values) => values.join('\n') + '\n';

/** `count` numbered lines, with some replaced: `{ 5: 'x' }` changes line 5, `null` drops it */
export function numbered(count, changes = {}) {
  return (
    Array.from({ length: count }, (_, index) => (index in changes ? changes[index] : `line ${index}`))
      .filter((line) => line !== null)
      .join('\n') + '\n'
  );
}
