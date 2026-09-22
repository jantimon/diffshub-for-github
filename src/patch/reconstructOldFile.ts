import type { FileDiffMetadata } from '@pierre/diffs';

/**
 * Rebuilds the old version of a file from its new version and the patch.
 *
 * Expanding collapsed context needs both sides in full, and GitHub only serves
 * raw files by commit sha. The pull request page gives us the head sha. The
 * commit the diff was taken against is not addressable, so the old side is
 * derived instead. A patch records every changed line on both sides, and the
 * lines between hunks are the same in both versions, so the result is exact.
 */
export function reconstructOldFile(fileDiff: FileDiffMetadata, newContents: string): string {
  const newLines = newContents.split('\n');
  const oldLines: string[] = [];
  let cursor = 0;

  for (const hunk of fileDiff.hunks) {
    // A hunk with no lines on a side is an insertion point, which sits after
    // the line the header names rather than at it
    const hunkStart = hunk.additionCount === 0 ? hunk.additionStart : hunk.additionStart - 1;

    for (let line = cursor; line < hunkStart && line < newLines.length; line += 1) {
      oldLines.push(newLines[line] ?? '');
    }

    // The parsed lines keep their line ending, which the split above dropped
    const from = hunk.deletionLineIndex;
    for (let offset = 0; offset < hunk.deletionCount; offset += 1) {
      const line = fileDiff.deletionLines[from + offset] ?? '';
      oldLines.push(line.endsWith('\n') ? line.slice(0, -1) : line);
    }

    cursor = hunkStart + hunk.additionCount;
  }

  for (let line = cursor; line < newLines.length; line += 1) {
    oldLines.push(newLines[line] ?? '');
  }

  return oldLines.join('\n');
}
