import { filesPaths, readPullRequestRef } from '../src/pullRequest.ts';

// GitHub serves two pull request layouts. The older one links its Files-changed
// tab at /files, the React one at /changes, and both have to open the viewer.
const ref = readPullRequestRef('/octocat/hello-world/pull/347');
const paths = filesPaths(ref);

const cases = [
  ['/octocat/hello-world/pull/347/files', true],
  ['/octocat/hello-world/pull/347/changes', true],
  ['/octocat/hello-world/pull/347', false],
  ['/octocat/hello-world/pull/347/commits', false],
  ['/octocat/hello-world/pull/347/checks', false],
  ['/octocat/hello-world/pull/348/files', false],
  ['/octocat/other/pull/347/files', false],
];

let failures = 0;
for (const [path, expected] of cases) {
  const actual = paths.includes(path);
  if (actual === expected) {
    console.log(`ok   ${expected ? 'opens  ' : 'ignores'} ${path}`);
    continue;
  }
  failures += 1;
  console.log(`FAIL ${path}: expected ${expected}, got ${actual}`);
}

if (ref.owner !== 'octocat' || ref.repo !== 'hello-world' || ref.number !== 347) {
  failures += 1;
  console.log(`FAIL parsed the wrong pull request: ${JSON.stringify(ref)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
