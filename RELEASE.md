# Releasing

A change reaches users in three steps:

1. Every pull request carries a short note for users, called a **changeset**.
2. A bot collects the notes into a **release pull request** that bumps the
   version and writes the changelog.
3. Merging the release pull request **ships** the new version to the Chrome Web
   Store and to addons.mozilla.org (AMO).

Nobody builds or uploads anything by hand. The tool behind steps 1 and 2 is
[Changesets](https://github.com/changesets/changesets).

## For contributors: add a changeset

Before you open a pull request, run:

```sh
pnpm changeset
```

It asks how big the change is and what to tell users, then writes a small file
to `.changeset/`. Commit it with your change.

| Kind | When | Example |
| --- | --- | --- |
| `patch` | a fix | 1.4.2 → 1.4.3 |
| `minor` | something new | 1.4.2 → 1.5.0 |
| `major` | something users must relearn | 1.4.2 → 2.0.0 |

Write the note for the people who use the extension, not for reviewers. It
appears word for word in `CHANGELOG.md`, on the GitHub Release and on AMO's
version page. Say what changed for them in plain words:

```md
---
'diffshub-for-github': patch
---

A comment on the first line of a file no longer opens on the second.
```

If users will not notice the change (tests, CI, docs, a refactor), add an empty
changeset instead:

```sh
pnpm changeset --empty
```

A pull request with no changeset at all fails the `changeset` check and cannot
merge.

## For maintainers: ship a release

```
your pull requests ──► merged to main, each with a changeset
                                │
                                ▼
          "chore: release" pull request, kept up to date by the bot:
          new version in package.json, new section in CHANGELOG.md
                                │
                                ▼  you merge it, once its checks pass
                                │
          tag v1.2.3 ─► GitHub Release with the notes and three zips
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
         Chrome Web Store               addons.mozilla.org
         goes live after                usually live within
         Google's review                minutes
```

1. Open the **chore: release** pull request. It exists whenever unreleased
   changesets are waiting on `main`, and it updates itself after each merge.
2. Read the new `CHANGELOG.md` section. This is what users will see. Edit the
   wording in the pull request if you want.
3. Merge it once its checks pass.

The `release` workflow then:

- tags the commit `v1.2.3` and creates the GitHub Release with the notes,
- builds the Chrome zip, the Firefox zip and the source zip AMO asks for, and
  attaches all three to the release,
- sends them to both stores (the `stores` workflow).

Chrome reviews each version before it goes live. That takes from a few hours to
a few days, and the version goes live by itself once approved. AMO checks the
upload automatically and usually lists it within minutes. A person at Mozilla
may review it later.

## When a store upload fails

Each store is its own job, so one can fail while the other succeeds. Nothing
else needs undoing: the tag and the GitHub Release stay as they are.

1. Fix the cause (usually an expired or wrong credential, see below).
2. Open **Actions → stores → Run workflow**, enter the version (`1.2.3`), and
   pick the store, or `both`.

A store that already has the version is skipped, so `both` is always safe. The
job sends the zips attached to the GitHub Release, never a fresh build, so a
retry ships the same bytes.

Do not bump the version to get around a failed upload. If the build itself is
wrong, fix it in a new pull request with a `patch` changeset.

## Setting it up

This is done once. Steps 1 to 3 let the release pull request work; steps 4 to 8
connect the stores.

### 1. The release app

The release pull request must run the same checks as any other pull request.
GitHub never starts workflows for changes made with Actions' built-in token, so
the bot needs a token of its own, from a small private GitHub App.

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Name: `diffshub-release`. Homepage URL: this repository. Untick
   **Webhook → Active**.
3. **Repository permissions:** Contents *Read and write*, Pull requests *Read
   and write*. Leave the rest at *No access*.
4. **Where can this app be installed:** Only on this account. Create it.
5. On the app's page, note the **Client ID**, then **Generate a private key**.
   A `.pem` file downloads.
6. **Install App** → this account → **Only select repositories** → this
   repository.
7. In this repository, **Settings → Secrets and variables → Actions**:
   - Variables tab: `RELEASE_APP_CLIENT_ID` = the Client ID.
   - Secrets tab: `RELEASE_APP_PRIVATE_KEY` = the whole `.pem` file.

Until `RELEASE_APP_CLIENT_ID` exists, the `release` workflow does nothing.

### 2. Required checks

**Settings → Rules → Rulesets → New branch ruleset**, targeting the default
branch:

- **Require a pull request before merging**.
- **Require status checks to pass**, with `check`, `changeset`,
  `browser-chromium` and `browser-firefox`.

From then on, changes to `main` go through pull requests, the release pull
request included.

### 3. The first release, 1.0.0

Neither store has a DiffsHub listing yet, and only a person can create one. So
the first release runs with the store uploads switched off.

1. Merge the pull request that adds this setup. It carries a `major`
   changeset, so the bot opens a release pull request for `1.0.0`.
2. Merge that. The workflow tags `v1.0.0` and attaches the zips to the GitHub
   Release. It skips the stores because `STORES_ENABLED` is not set yet.
3. Download the three zips from the release.

**Chrome Web Store**

1. [Developer dashboard](https://chrome.google.com/webstore/devconsole), as the
   `ghommey` publisher → **New item** → upload
   `diffshub-for-github-1.0.0-chrome.zip`.
2. Fill in the listing: description, category, screenshots (`docs/images/`
   has some), the privacy tab (no data collected; the host permissions exist to
   fetch the patch from github.com), visibility *Public*.
3. **Submit for review.**
4. Note the **item ID** (in the item's URL) and the **publisher ID** (under
   *Account*).

**addons.mozilla.org**

1. [Developer Hub](https://addons.mozilla.org/developers/) → **Submit a New
   Add-on** → *On this site* → upload `diffshub-for-github-1.0.0-firefox.zip`.
2. When asked for source code, answer yes and upload
   `diffshub-for-github-1.0.0-sources.zip`. Point the reviewer to "Building
   from source" at the end of this file.
3. Fill in the listing and submit.

### 4. Chrome credentials

Chrome's API signs in with a Google Cloud service account.

1. [Google Cloud console](https://console.cloud.google.com) → create a project,
   e.g. `diffshub-release`.
2. **APIs & Services → Library** → enable **Chrome Web Store API**.
3. **IAM & Admin → Service accounts → Create service account**. No roles needed.
4. Open it → **Keys → Add key → JSON**. A file downloads. You need its
   `client_email` and `private_key`.
5. Chrome developer dashboard → **Account** → add the service account's email
   as a service account for the publisher.

### 5. Firefox credentials

[AMO → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/)
→ **Generate new credentials**. Note the **JWT issuer** and the **JWT secret**.

### 6. The `stores` environment

**Settings → Environments → New environment** named `stores`. Under
*Deployment branches and tags*, choose *Selected branches and tags* and add
`main`. Then add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CHROME_PUBLISHER_ID` | publisher ID, step 3 |
| Variable | `CHROME_EXTENSION_ID` | item ID, step 3 |
| Secret | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | `client_email` from the JSON key |
| Secret | `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | `private_key` from the JSON key |
| Secret | `FIREFOX_JWT_ISSUER` | JWT issuer |
| Secret | `FIREFOX_JWT_SECRET` | JWT secret |

Then check them without uploading: **Actions → stores → Run workflow**,
version `1.0.0`, tick **dry-run**. Both jobs should pass.

### 7. Verified uploads for Chrome

With verified uploads on, Chrome accepts only packages signed with a key you
hold. Someone who steals the service account key still cannot ship an update.

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out diffshub-upload.pem
openssl pkey -in diffshub-upload.pem -pubout
```

1. Chrome developer dashboard → the item → **Package** → opt in to verified
   uploads, and paste the public key the second command printed.
2. Add the secret `CHROME_UPLOAD_SIGNING_KEY` to the `stores` environment: the
   whole of `diffshub-upload.pem`.
3. Keep a copy of `diffshub-upload.pem` somewhere safe and offline. Losing it
   means asking Chrome Web Store support to reset the key.

`scripts/release/sign-crx.mjs` signs the zip when this secret is set. It is
about sixty lines on Node's own crypto, so no third-party package handles the
key.

### 8. Switch the stores on

**Settings → Secrets and variables → Actions → Variables**:
`STORES_ENABLED` = `true`. From the next release on, merging the release pull
request is the whole release.

## Credentials

| What | Lasts | When it stops working |
| --- | --- | --- |
| Release app private key | until revoked | generate a new one on the app's page, replace `RELEASE_APP_PRIVATE_KEY` |
| Chrome service account key | until deleted | add a new JSON key, replace both `CHROME_SERVICE_ACCOUNT_*` secrets, delete the old key |
| AMO JWT credentials | until revoked | generate new ones on the API keys page |
| Chrome signing key | for good | only Chrome Web Store support can reset it |

The store secrets live in the `stores` environment, which only `main` can use,
so a workflow on another branch or a fork cannot read them. Every action in the
workflows is pinned to a commit, and Dependabot proposes new pins. Its pull
requests need an empty changeset like any other.

## Test recordings

The browser checks replay github.com from recordings in `test/har/`, so CI
needs no GitHub login. The recordings are made signed out, and a unit test fails
if one ever holds a session.

When `pnpm test:live` fails locally because GitHub changed, record again:

```sh
pnpm build && pnpm test:record
pnpm build:firefox && pnpm test:firefox:record
```

Commit the changed folders in `test/har/`. One thing is not replayed: in
Firefox the patch is fetched by the background script, which Playwright cannot
intercept, so that one request goes to github.com on each run.

## Building from source

For AMO reviewers, and anyone who wants to check that a store build matches this
code. The source zip attached to each release is enough.

Requirements: Node.js 22.18, pnpm 10.17.1.

```sh
pnpm install --frozen-lockfile
pnpm zip:firefox   # -> .output/diffshub-for-github-<version>-firefox.zip
pnpm zip           # -> .output/diffshub-for-github-<version>-chrome.zip
```

The unpacked builds are in `.output/firefox-mv3` and `.output/chrome-mv3`.
