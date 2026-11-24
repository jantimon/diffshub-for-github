import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

/**
 * The recordings in `test/har` are committed, so the ones there now are
 * checked too: no credential header, no parsed cookie, and every page GitHub
 * served names nobody as the reader. A recording made signed in fails here
 */
test('the committed recordings were made signed out', () => {
  const harRoot = path.resolve(import.meta.dirname, '../har');
  const suites = fs.existsSync(harRoot)
    ? fs.readdirSync(harRoot).filter((name) => name.endsWith('.zip'))
    : [];
  assert.ok(suites.length > 0, 'there is a recording to check');

  for (const suite of suites) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-har-committed-'));
    try {
      execFileSync('unzip', ['-q', path.join(harRoot, suite), '-d', dir]);
      const har = JSON.parse(fs.readFileSync(path.join(dir, 'recording.har'), 'utf8'));
      for (const entry of har.log.entries) {
        for (const side of [entry.request, entry.response]) {
          const kept = side.headers.filter((header) =>
            ['cookie', 'set-cookie', 'authorization'].includes(header.name.toLowerCase()),
          );
          assert.deepEqual(kept, [], `${suite}: ${entry.request.url} keeps a credential header`);
          assert.deepEqual(side.cookies, [], `${suite}: ${entry.request.url} keeps a cookie`);
        }
      }

      for (const file of fs.readdirSync(dir)) {
        const body = fs.readFileSync(path.join(dir, file), 'latin1');
        assert.ok(!/user_session=|_gh_sess=|logged_in=yes/.test(body), `${suite}/${file} holds a session`);
        const reader = /<meta name="user-login" content="([^"]*)"/.exec(body)?.[1] ?? '';
        assert.equal(reader, '', `${suite}/${file} was served to ${reader}, signed in`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
