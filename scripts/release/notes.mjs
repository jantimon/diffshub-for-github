/**
 * Pulls one version's notes out of CHANGELOG.md for the stores.
 *
 *   node scripts/release/notes.mjs 1.2.3 out/
 *
 * Writes `out/release-notes.md`, the section as written, and
 * `out/amo-metadata.json`, the same notes as AMO wants them. AMO shows release
 * notes as plain text with a few HTML tags, so the Markdown headings and
 * bullets become plain lines
 */

import fs from 'node:fs';
import path from 'node:path';

const [version, outDir = '.'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/release/notes.mjs <x.y.z> [out-dir]');
  process.exit(1);
}

function sectionFor(changelog, wanted) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${wanted}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function asPlainText(markdown) {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^### (.*)$/, '$1:')
        .replace(/^- /, '• ')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1'),
    )
    .join('\n');
}

const notes = sectionFor(fs.readFileSync('CHANGELOG.md', 'utf8'), version);
if (notes == null) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'release-notes.md'), `${notes}\n`);
fs.writeFileSync(
  path.join(outDir, 'amo-metadata.json'),
  JSON.stringify({ version: { release_notes: { 'en-US': asPlainText(notes) } } }, null, 2),
);
console.log(asPlainText(notes));
