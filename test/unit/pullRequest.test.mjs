import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readPullRequestRef } from '../../src/shared/pullRequest.ts';

// Every page of a pull request names it, and nothing else does. The browser
// suite opens one URL, so the others are pinned here
test('which pull request a path names', () => {
  const hello = (number) => ({ owner: 'octocat', repo: 'hello-world', number });
  for (const [path, expected] of [
    ['/octocat/hello-world/pull/347', hello(347)],
    ['/octocat/hello-world/pull/347/files', hello(347)],
    ['/octocat/hello-world/pull/347/changes', hello(347)],
    ['/octocat/hello-world/pull/347/commits/abc123', hello(347)],
    ['/my.org/repo-name.js/pull/5', { owner: 'my.org', repo: 'repo-name.js', number: 5 }],
    ['/octocat/hello-world/pulls', undefined],
    ['/octocat/hello-world/pull/new/main', undefined],
    ['/octocat/hello-world/issues/347', undefined],
  ]) {
    assert.deepEqual(readPullRequestRef(path), expected, path);
  }
});
