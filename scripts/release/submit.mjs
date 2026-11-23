/**
 * Sends one version to one store with `wxt submit`.
 *
 *   node scripts/release/submit.mjs chrome  1.2.3 release/ [--dry-run]
 *   node scripts/release/submit.mjs firefox 1.2.3 release/ [--dry-run]
 *
 * `release/` holds the files attached to the GitHub Release, so a retry sends
 * exactly the bytes the first attempt built. The credentials come from the
 * environment, under the names `wxt submit` reads (see RELEASE.md).
 *
 * Before uploading it asks the store whether it already has this version. A
 * store never takes the same version twice, so after a run where one store
 * succeeded and the other failed, running both again must skip the one that
 * worked rather than fail on it
 */

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { signCrx } from './sign-crx.mjs';

const [store, version, dir, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
if (!['chrome', 'firefox'].includes(store) || !/^\d+\.\d+\.\d+$/.test(version ?? '') || dir == null) {
  console.error('usage: node scripts/release/submit.mjs <chrome|firefox> <x.y.z> <dir> [--dry-run]');
  process.exit(1);
}

const asset = (kind) => {
  const file = path.join(dir, `diffshub-for-github-${version}-${kind}.zip`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  return file;
};

/** GitHub stores a multi-line secret pasted with literal `\n` as written */
const pem = (value) => value?.replace(/\\n/g, '\n');

const base64url = (value) => Buffer.from(value).toString('base64url');

function jwt(header, payload, sign) {
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${body}.${base64url(sign(body))}`;
}

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

async function chromeHasVersion() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: need('CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL'),
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    },
    (body) => crypto.sign('sha256', Buffer.from(body), pem(need('CHROME_SERVICE_ACCOUNT_PRIVATE_KEY'))),
  );
  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!token.ok) throw new Error(`Google refused the service account: ${token.status} ${await token.text()}`);
  const { access_token } = await token.json();

  const item = `publishers/${need('CHROME_PUBLISHER_ID')}/items/${need('CHROME_EXTENSION_ID')}`;
  const status = await fetch(`https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!status.ok) throw new Error(`Chrome Web Store status: ${status.status} ${await status.text()}`);
  const answer = await status.json();
  const versions = [answer.publishedItemRevisionStatus, answer.submittedItemRevisionStatus]
    .flatMap((revision) => revision?.distributionChannels ?? [])
    .map((channel) => channel.crxVersion);
  return versions.includes(version);
}

async function firefoxHasVersion() {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt(
    { alg: 'HS256', typ: 'JWT' },
    { iss: need('FIREFOX_JWT_ISSUER'), jti: crypto.randomUUID(), iat: now, exp: now + 60 },
    (body) => crypto.createHmac('sha256', need('FIREFOX_JWT_SECRET')).update(body).digest(),
  );
  const guid = encodeURIComponent(need('FIREFOX_EXTENSION_ID'));
  const answer = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${guid}/versions/v${version}/`, {
    headers: { Authorization: `JWT ${token}` },
  });
  if (answer.status === 404) return false;
  if (!answer.ok) throw new Error(`AMO version lookup: ${answer.status} ${await answer.text()}`);
  return true;
}

if (await (store === 'chrome' ? chromeHasVersion() : firefoxHasVersion())) {
  console.log(`${store} already has ${version}, nothing to send`);
  process.exit(0);
}

const args = ['exec', 'wxt', 'submit'];
const env = { ...process.env };
if (dryRun) args.push('--dry-run');

if (store === 'chrome') {
  env.CHROME_API_VERSION = 'v2';
  env.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY = pem(env.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY);
  let upload = asset('chrome');
  // Signed only once the item is opted in to verified uploads, which happens
  // after the first version is in the store
  const signingKey = pem(process.env.CHROME_UPLOAD_SIGNING_KEY);
  if (signingKey) {
    upload = upload.replace(/\.zip$/, '.crx');
    fs.writeFileSync(upload, signCrx(fs.readFileSync(asset('chrome')), signingKey));
    console.log(`signed for verified upload: ${upload}`);
  }
  args.push('--chrome-zip', upload);
} else {
  const metadata = path.join(dir, 'amo-metadata.json');
  args.push('--firefox-zip', asset('firefox'), '--firefox-sources-zip', asset('sources'));
  if (fs.existsSync(metadata)) args.push('--firefox-amo-metadata-file', metadata);
}

const run = spawnSync('pnpm', args, { stdio: 'inherit', env });
process.exit(run.status ?? 1);
