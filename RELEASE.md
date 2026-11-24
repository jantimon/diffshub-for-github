# Releasing

A change reaches users in three steps:

1. Every pull request carries a short note for users, called a **changeset**.
2. A bot collects the notes into a **release pull request** that bumps the
   version and writes the changelog.
3. Merging the release pull request ships the new version to the Chrome Web
   Store and to addons.mozilla.org (AMO).

Nobody builds or uploads anything by hand. Steps 1 and 2 are
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
version page:

```md
---
'diffshub-for-github': patch
---

A comment on the first line of a file no longer opens on the second.
```

If users will not notice the change (tests, CI, docs, a refactor), add an empty
changeset:

```sh
pnpm changeset --empty
```

A pull request without a changeset fails the `changeset` check and cannot
merge.

## For maintainers: ship a release

```
your pull requests ──► merged to main, each with a changeset
                                │
                                ▼
          "chore: release" pull request, kept up to date by the bot:
          new version in package.json, new section in CHANGELOG.md
                                │
                                ▼  you merge it
                                │
          tag v1.2.3 ─► GitHub Release with the notes and three zips
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
         Chrome Web Store               addons.mozilla.org
         live after Google's            usually live within
         review, hours to days          minutes
```

The **chore: release** pull request exists whenever unreleased changesets wait
on `main`. Read its `CHANGELOG.md` section, since users will see it, and edit
the wording there if you want. Then merge it.

It shows no checks: the bot opens it with Actions' built-in token, and GitHub
runs no workflows for that token. As a repository admin you can merge past the
ruleset. The pull request only changes the version, the changelog and the
changeset files, and each change it collects passed its checks on its own pull
request.

## When a store upload fails

Each store has its own job, so one can fail while the other succeeds. The tag
and the GitHub Release stay as they are.

1. Fix the cause, usually an expired or wrong credential (see below).
2. **Actions → stores → Run workflow**, enter the version (`1.2.3`), and pick
   the store, or `both`.

The job skips a store that already has the version, so `both` is always safe.
It sends the zips attached to the GitHub Release, never a fresh build, so a
retry ships the same bytes. Tick **dry-run** to check the credentials without
uploading.

Do not bump the version to get around a failed upload. If the build itself is
wrong, fix it in a new pull request with a `patch` changeset.

## Credentials

The store credentials are secrets in the `stores` environment, which only
`main` can use.

| Secret | Comes from | To replace it |
| --- | --- | --- |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | a JSON key of the Google Cloud service account | add a new JSON key, update both secrets, delete the old key |
| `CHROME_UPLOAD_SIGNING_KEY` | the private key whose public half Chrome holds for verified uploads | only Chrome Web Store support can reset it, so keep an offline copy |
| `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` | [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/) | generate new ones there |

The store jobs only run while the repository variable `STORES_ENABLED` is
`true`. Every action in the workflows is pinned to a commit, and Dependabot
proposes new pins. Its pull requests need an empty changeset like any other.

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
