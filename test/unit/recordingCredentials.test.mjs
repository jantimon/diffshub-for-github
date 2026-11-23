import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { stripCredentials } from '../browser.mjs';

/**
 * The recorded suite runs signed out, but github.com hands an anonymous session
 * to anyone who asks, so a fresh recording arrives carrying `Cookie` and
 * `Set-Cookie`. The file is gitignored, and this is the second lock: the bytes
 * are harmless wherever the file ends up. It builds a recording by hand.
 */
test('a recording cannot keep credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diffshub-har-check-'));
  const file = path.join(dir, 'sample.har');
  const entry = (url) => ({
    request: {
      url,
      headers: [
        { name: 'accept', value: 'application/json' },
        { name: 'Cookie', value: '_gh_sess=SECRET; logged_in=no' },
        { name: 'Authorization', value: 'Bearer SECRET' },
      ],
      cookies: [{ name: '_gh_sess', value: 'SECRET' }],
    },
    response: {
      headers: [
        { name: 'content-type', value: 'application/json' },
        { name: 'Set-Cookie', value: '_gh_sess=SECRET; Path=/; HttpOnly' },
      ],
      cookies: [{ name: '_gh_sess', value: 'SECRET' }],
    },
  });
  fs.writeFileSync(
    file,
    JSON.stringify({ log: { entries: [entry('https://github.com/a'), entry('https://github.com/b')] } }),
  );

  try {
    assert.equal(stripCredentials(file), 6, 'every credential header is removed');
    const cleaned = fs.readFileSync(file, 'utf8');
    assert.ok(!cleaned.includes('SECRET'));
    assert.ok(!/"name":"(Cookie|Set-Cookie|Authorization)"/i.test(cleaned));
    assert.ok(!cleaned.includes('"_gh_sess"'), 'the parsed cookie lists are emptied');
    assert.ok(cleaned.includes('application/json'), 'what the tests read is kept');
    assert.equal(stripCredentials(path.join(dir, 'absent.har')), 0, 'a missing recording is not an error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
