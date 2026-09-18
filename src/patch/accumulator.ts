import { processFile, type CodeViewItem, type FileDiffMetadata } from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

export interface DiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLines: number;
}

export interface PatchAccumulator {
  /** Files parsed so far, in patch order. */
  readonly items: CodeViewItem<undefined>[];
  /** Items added since the last {@link takePendingItems}. */
  pending: CodeViewItem<undefined>[];
  readonly paths: string[];
  /** Paths added since the last {@link takePendingPaths}. */
  pendingPaths: string[];
  readonly gitStatus: GitStatusEntry[];
  readonly pathToItemId: Map<string, string>;
  readonly stats: DiffStats;
  /** Files dropped by the exclude filter, for the "N hidden" count. */
  hiddenCount: number;
  fileIndex: number;
}

export function createAccumulator(): PatchAccumulator {
  return {
    items: [],
    pending: [],
    paths: [],
    pendingPaths: [],
    gitStatus: [],
    pathToItemId: new Map(),
    stats: { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 },
    hiddenCount: 0,
    fileIndex: 0,
  };
}

const STATUS_BY_CHANGE_TYPE: Record<string, GitStatusEntry['status'] | undefined> = {
  new: 'added',
  deleted: 'deleted',
  'rename-pure': 'renamed',
  'rename-changed': 'renamed',
};

/**
 * Parses one file's patch text and folds it into the accumulator.
 *
 * `isExcluded` runs before anything is stored, so a filtered file never reaches
 * the tree or the viewer at all.
 */
export function appendFile(
  accumulator: PatchAccumulator,
  fileText: string,
  cacheKeyPrefix: string,
  isExcluded: (path: string) => boolean
): void {
  const fileDiff = processFile(fileText, {
    cacheKey: `${cacheKeyPrefix}-${accumulator.fileIndex}`,
    isGitDiff: true,
  });
  if (fileDiff == null) return;
  accumulator.fileIndex += 1;

  const path = fileDiff.name;
  if (isExcluded(path)) {
    accumulator.hiddenCount += 1;
    return;
  }

  const id = uniqueId(accumulator, path);
  const item: CodeViewItem<undefined> = { id, type: 'diff', fileDiff, version: 0 };

  accumulator.items.push(item);
  accumulator.pending.push(item);
  accumulator.paths.push(path);
  accumulator.pendingPaths.push(path);
  accumulator.pathToItemId.set(path, id);

  const status = STATUS_BY_CHANGE_TYPE[fileDiff.type];
  if (status != null) accumulator.gitStatus.push({ path, status });

  addStats(accumulator.stats, fileDiff);
}

function uniqueId(accumulator: PatchAccumulator, path: string): string {
  if (!accumulator.pathToItemId.has(path)) return path;
  let suffix = 2;
  while (accumulator.pathToItemId.has(`${path}?${suffix}`)) suffix += 1;
  return `${path}?${suffix}`;
}

function addStats(stats: DiffStats, fileDiff: FileDiffMetadata): void {
  stats.fileCount += 1;
  stats.totalLines += fileDiff.unifiedLineCount ?? 0;
  for (const hunk of fileDiff.hunks ?? []) {
    stats.addedLines += hunk.additionLines ?? 0;
    stats.deletedLines += hunk.deletionLines ?? 0;
  }
}

export function takePendingItems(accumulator: PatchAccumulator): CodeViewItem<undefined>[] {
  const pending = accumulator.pending;
  accumulator.pending = [];
  return pending;
}

export function takePendingPaths(accumulator: PatchAccumulator): string[] {
  const pending = accumulator.pendingPaths;
  accumulator.pendingPaths = [];
  return pending;
}
