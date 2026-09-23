import { processFile, type CodeViewItem } from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

import type { ReviewThread } from '@/shared/bridge';
import { changesOnlyWhitespace } from './whitespace';

export interface ParsedFile {
  item: CodeViewItem<ReviewThread>;
  path: string;
  /** Nothing changed here but spacing */
  spacingOnly: boolean;
  status?: GitStatusEntry['status'];
  addedLines: number;
  deletedLines: number;
  totalLines: number;
}

export interface DiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLines: number;
}

export interface PatchAccumulator {
  /** Every file in the patch, in patch order, whether or not a filter hides it */
  readonly files: ParsedFile[];
  /** Ids already handed out, so a path the patch lists twice still gets one of its own */
  readonly ids: Set<string>;
}

export function createAccumulator(): PatchAccumulator {
  return { files: [], ids: new Set() };
}

/**
 * The tree paints a file by its status, and treats a modified one as the
 * ordinary case with no mark of its own
 */
const TREE_STATUS: Record<string, GitStatusEntry['status']> = {
  new: 'added',
  deleted: 'deleted',
  'rename-pure': 'renamed',
  'rename-changed': 'renamed',
};

/** Parses one file's patch text and adds it to the accumulator */
export function appendFile(
  accumulator: PatchAccumulator,
  fileText: string,
  cacheKeyPrefix: string,
): ParsedFile | undefined {
  const fileDiff = processFile(fileText, {
    cacheKey: `${cacheKeyPrefix}-${accumulator.files.length}`,
    isGitDiff: true,
  });
  if (fileDiff == null) return undefined;

  const path = fileDiff.name;
  const id = uniqueId(accumulator, path);
  accumulator.ids.add(id);

  let addedLines = 0;
  let deletedLines = 0;
  for (const hunk of fileDiff.hunks) {
    addedLines += hunk.additionLines;
    deletedLines += hunk.deletionLines;
  }

  const parsed: ParsedFile = {
    item: { id, type: 'diff', fileDiff, version: 0 },
    path,
    spacingOnly: changesOnlyWhitespace(fileDiff),
    status: TREE_STATUS[fileDiff.type],
    addedLines,
    deletedLines,
    totalLines: fileDiff.unifiedLineCount,
  };

  accumulator.files.push(parsed);
  return parsed;
}

function uniqueId(accumulator: PatchAccumulator, path: string): string {
  if (!accumulator.ids.has(path)) return path;
  let suffix = 2;
  while (accumulator.ids.has(`${path}?${suffix}`)) suffix += 1;
  return `${path}?${suffix}`;
}

export function sumStats(files: readonly ParsedFile[]): DiffStats {
  const stats: DiffStats = { addedLines: 0, deletedLines: 0, fileCount: files.length, totalLines: 0 };
  for (const file of files) {
    stats.addedLines += file.addedLines;
    stats.deletedLines += file.deletedLines;
    stats.totalLines += file.totalLines;
  }
  return stats;
}
