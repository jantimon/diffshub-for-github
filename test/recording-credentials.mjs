/**
 * Proves a recording cannot keep credentials.
 *
 * The recorded suite runs signed out, but github.com hands an anonymous session
 * to anyone who asks, so a fresh recording arrives carrying `Cookie` and
 * `Set-Cookie`. The file is gitignored, and this is the second lock: the bytes
 * are harmless wherever the file ends up.
 *
 * Offline. It builds a recording by hand rather than making one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stripCredentials } from './browser.mjs';

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

const removed = stripCredentials(file);
const cleaned = fs.readFileSync(file, 'utf8');

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail == null ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

check('every credential header is removed', removed === 6, `${removed} removed`);
check('the word SECRET is gone from the file', !cleaned.includes('SECRET'));
check('no cookie header survives', !/"name":"(Cookie|Set-Cookie|Authorization)"/i.test(cleaned));
check('the parsed cookie lists are emptied', !cleaned.includes('"_gh_sess"'));
check('what the tests actually read is kept', cleaned.includes('application/json'));
check('a missing recording is not an error', stripCredentials(path.join(dir, 'absent.har')) === 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
