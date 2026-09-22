import picomatch from 'picomatch/posix.js';

export interface FileFilter {
  isVisible: (path: string) => boolean;
  includeError?: string;
  excludeError?: string;
}

const SHOW_EVERYTHING: FileFilter = { isVisible: () => true };

/**
 * Turns two comma- or newline-separated lists of globs into one test.
 *
 * Git paths always use forward slashes, which is why this uses picomatch's
 * posix entry rather than the platform-sensitive default. An unusable pattern
 * reports itself and is ignored, rather than emptying the view.
 */
export function compileFilters(include: string, exclude: string): FileFilter {
  const included = compile(include);
  const excluded = compile(exclude);

  if (included.match == null && excluded.match == null) {
    return { ...SHOW_EVERYTHING, includeError: included.error, excludeError: excluded.error };
  }

  return {
    isVisible: (path) =>
      (included.match == null || included.match(path)) && (excluded.match == null || !excluded.match(path)),
    includeError: included.error,
    excludeError: excluded.error,
  };
}

function compile(input: string): { match?: (path: string) => boolean; error?: string } {
  const patterns = input
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');

  if (patterns.length === 0) return {};

  try {
    // A bare `*.test.ts` reads as "anywhere", the way a search box is expected
    // to behave; a pattern with a slash stays anchored to the whole path.
    const expanded = patterns.flatMap((pattern) =>
      pattern.includes('/') ? [pattern] : [pattern, `**/${pattern}`],
    );
    const match = picomatch(expanded, { dot: true });
    return { match: (path) => match(path) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
