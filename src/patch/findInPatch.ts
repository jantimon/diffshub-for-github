import type { FileDiffMetadata } from '@pierre/diffs';

import type { ParsedFile } from './accumulator.ts';
import { describeError } from '../shared/errors.ts';

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export type FindSide = 'additions' | 'deletions';

export interface FindMatch {
  id: string;
  side: FindSide;
  lineNumber: number;
  start: number;
  end: number;
}

/** Which rows of each collapsed gap the reader opened, keyed by the hunk below the gap */
export type Expansion = ReadonlyMap<number, { fromStart: number; fromEnd: number }>;

/**
 * Enough to step through, and few enough that a one-letter query on a twenty
 * megabyte patch answers while the reader is still typing
 */
export const MAX_MATCHES = 10_000;

/**
 * The viewer's own threshold: a gap this short is shown in full once the file
 * is loaded, so it is searched in full too
 */
const SHOWN_WHOLE = 1;

export function compileQuery(query: string, options: FindOptions): { pattern?: RegExp; error?: string } {
  if (query === '') return {};
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return { pattern: new RegExp(source, options.caseSensitive ? 'gu' : 'giu') };
  } catch (error) {
    return { error: describeError(error) };
  }
}

/** Every match on one line. Empty matches are stepped over, or `a*` would never finish */
export function matchesIn(text: string, pattern: RegExp): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match != null; match = pattern.exec(text)) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }
    found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/**
 * Searches what the diff can show: the patch's own lines, and the parts of a
 * collapsed gap the reader opened. Files are taken in the order given, which is
 * the order they appear in.
 */
export function findInFiles(
  files: readonly ParsedFile[],
  pattern: RegExp,
  expansionOf: (fileDiff: FileDiffMetadata) => Expansion | undefined,
): { matches: FindMatch[]; capped: boolean } {
  const matches: FindMatch[] = [];
  for (const file of files) {
    for (const line of searchableLines(file.item.fileDiff, expansionOf(file.item.fileDiff))) {
      for (const { start, end } of matchesIn(line.text, pattern)) {
        matches.push({ id: file.item.id, side: line.side, lineNumber: line.lineNumber, start, end });
        if (matches.length >= MAX_MATCHES) return { matches, capped: true };
      }
    }
  }
  return { matches, capped: false };
}

interface Line {
  side: FindSide;
  lineNumber: number;
  text: string;
}

/**
 * The lines in the order the diff draws them. A context line sits in both
 * columns of a split view, so it is taken once, from the new side. Within a
 * change, removed lines come before added ones.
 */
function searchableLines(fileDiff: FileDiffMetadata, expansion: Expansion | undefined): Line[] {
  const lines: Line[] = [];
  const { hunks, additionLines, deletionLines } = fileDiff;
  // A file loaded in full holds every line of the new side, which is what the
  // opened gaps are read from. Until then only the patch's lines exist. The
  // viewer loads into this same object: `src/viewer/diff/expandedRegions.ts`
  const loaded = !fileDiff.isPartial;

  for (const [index, hunk] of hunks.entries()) {
    if (loaded) {
      const gapEnd = hunk.additionCount === 0 ? hunk.additionStart : hunk.additionStart - 1;
      lines.push(
        ...openedRows(additionLines, gapEnd - hunk.collapsedBefore + 1, gapEnd, expansion?.get(index), true),
      );
    }

    const newLine = (at: number) => hunk.additionStart + (at - hunk.additionLineIndex);
    const oldLine = (at: number) => hunk.deletionStart + (at - hunk.deletionLineIndex);
    for (const block of hunk.hunkContent) {
      if (block.type === 'context') {
        for (let at = block.additionLineIndex; at < block.additionLineIndex + block.lines; at += 1) {
          lines.push({ side: 'additions', lineNumber: newLine(at), text: clean(additionLines[at]) });
        }
        continue;
      }
      for (let at = block.deletionLineIndex; at < block.deletionLineIndex + block.deletions; at += 1) {
        lines.push({ side: 'deletions', lineNumber: oldLine(at), text: clean(deletionLines[at]) });
      }
      for (let at = block.additionLineIndex; at < block.additionLineIndex + block.additions; at += 1) {
        lines.push({ side: 'additions', lineNumber: newLine(at), text: clean(additionLines[at]) });
      }
    }
  }

  const last = hunks.at(-1);
  if (loaded && last != null) {
    const lastEnd =
      last.additionCount === 0 ? last.additionStart : last.additionStart + last.additionCount - 1;
    lines.push(
      ...openedRows(additionLines, lastEnd + 1, additionLines.length, expansion?.get(hunks.length), false),
    );
  }
  return lines;
}

/**
 * The rows of one gap, `first` to `last` in new-file line numbers, that are on
 * show. A gap opens from its top and, between two hunks, from its bottom too.
 */
function openedRows(
  source: readonly string[],
  first: number,
  last: number,
  region: { fromStart: number; fromEnd: number } | undefined,
  opensFromBottom: boolean,
): Line[] {
  const size = last - first + 1;
  if (size <= 0) return [];
  let fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), size);
  let fromEnd = opensFromBottom ? Math.min(Math.max(region?.fromEnd ?? 0, 0), size) : 0;
  if (size <= SHOWN_WHOLE || fromStart + fromEnd >= size) {
    fromStart = size;
    fromEnd = 0;
  }
  const rows: Line[] = [];
  const take = (lineNumber: number) =>
    rows.push({ side: 'additions', lineNumber, text: clean(source[lineNumber - 1]) });
  for (let lineNumber = first; lineNumber < first + fromStart; lineNumber += 1) take(lineNumber);
  for (let lineNumber = last - fromEnd + 1; lineNumber <= last; lineNumber += 1) take(lineNumber);
  return rows;
}

/** Lines keep their line ending, which is not text anyone searches for */
function clean(line: string | undefined): string {
  return (line ?? '').replace(/\r?\n$/, '');
}
