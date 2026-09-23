import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filesPaths, readPullRequestRef } from '../../src/shared/pullRequest.ts';

// GitHub serves two pull request layouts. The older one links its Files-changed
// tab at /files, the React one at /changes, and both have to open the viewer,
// while the browser suite only meets whichever layout its pull request renders
test('both Files-changed paths open the viewer', () => {
  const paths = filesPaths(readPullRequestRef('/octocat/hello-world/pull/347'));
  assert.ok(paths.includes('/octocat/hello-world/pull/347/files'));
  assert.ok(paths.includes('/octocat/hello-world/pull/347/changes'));
});

test('a path that is not a pull request has no reference', () => {
  assert.equal(readPullRequestRef('/octocat/hello-world/issues/347'), undefined);
});
