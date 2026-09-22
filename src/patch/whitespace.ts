import type { FileDiffMetadata } from '@pierre/diffs';

/**
 * Telling apart a real change from a change of spacing.
 *
 * A reformatting commit -- a prettier run, a re-indent, a change of line
 * endings -- touches dozens of files and says nothing. GitHub answers that with
 * `?w=1`, but its `.diff` endpoint takes no such parameter, so the comparison
 * has to be made here.
 *
 * This works a file at a time rather than a line at a time, and that is
 * deliberate. Dropping individual lines would renumber what is left, and a
 * comment anchored to a renumbered line is a comment on the wrong code. Hiding
 * a whole file changes nothing about the files still shown: every line keeps
 * the number GitHub gave it, so anchors stay sound.
 */

/** Everything that is not a space, tab, carriage return or newline */
function withoutSpacing(line: string): string {
  return line.replace(/\s+/g, '');
}

/**
 * Whether the only thing that changed in this file is spacing.
 *
 * A file that was added or deleted is a real change whatever its contents, and
 * a file whose hunks add or remove a different number of lines cannot be a
 * reformatting.
 */
export function changesOnlyWhitespace(fileDiff: FileDiffMetadata): boolean {
  if (fileDiff.type !== 'change' && fileDiff.type !== 'rename-changed') return false;
  if (fileDiff.hunks.length === 0) return false;

  for (const hunk of fileDiff.hunks) {
    const removed = fileDiff.deletionLines
      .slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount)
      .map(withoutSpacing)
      .filter((line) => line !== '');
    const added = fileDiff.additionLines
      .slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount)
      .map(withoutSpacing)
      .filter((line) => line !== '');

    if (removed.length !== added.length) return false;
    for (let index = 0; index < removed.length; index += 1) {
      if (removed[index] !== added[index]) return false;
    }
  }

  return true;
}
