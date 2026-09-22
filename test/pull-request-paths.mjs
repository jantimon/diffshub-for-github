import { filesPaths, readPullRequestRef } from '../src/pullRequest.ts';

// GitHub serves two pull request layouts. The older one links its Files-changed
// tab at /files, the React one at /changes, and both have to open the viewer.
// The browser suite only ever meets whichever layout its pull request renders
const paths = filesPaths(readPullRequestRef('/octocat/hello-world/pull/347'));

let failures = 0;
for (const path of ['/octocat/hello-world/pull/347/files', '/octocat/hello-world/pull/347/changes']) {
  if (paths.includes(path)) {
    console.log(`ok   opens ${path}`);
    continue;
  }
  failures += 1;
  console.log(`FAIL does not open ${path}`);
}

process.exit(failures === 0 ? 0 : 1);
