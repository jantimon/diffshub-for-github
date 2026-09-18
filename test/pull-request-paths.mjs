import { filesPaths, readPullRequestRef } from '../src/github/pr.ts';

// GitHub serves two pull request layouts. The older one links its Files-changed
// tab at /files, the React one at /changes, and both have to open the viewer.
const ref = readPullRequestRef('/DigitecGalaxus/isomorph/pull/10797');
const paths = filesPaths(ref);

const cases = [
  ['/DigitecGalaxus/isomorph/pull/10797/files', true],
  ['/DigitecGalaxus/isomorph/pull/10797/changes', true],
  ['/DigitecGalaxus/isomorph/pull/10797', false],
  ['/DigitecGalaxus/isomorph/pull/10797/commits', false],
  ['/DigitecGalaxus/isomorph/pull/10797/checks', false],
  ['/DigitecGalaxus/isomorph/pull/10798/files', false],
  ['/DigitecGalaxus/other/pull/10797/files', false],
];

let failures = 0;
for (const [path, expected] of cases) {
  const actual = paths.includes(path);
  if (actual === expected) { console.log(`ok   ${expected ? 'opens  ' : 'ignores'} ${path}`); continue; }
  failures += 1;
  console.log(`FAIL ${path}: expected ${expected}, got ${actual}`);
}

if (ref.owner !== 'DigitecGalaxus' || ref.repo !== 'isomorph' || ref.number !== 10797) {
  failures += 1;
  console.log(`FAIL parsed the wrong pull request: ${JSON.stringify(ref)}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
