import picomatch from 'picomatch/posix.js';

export interface MatchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export interface FileFilter {
  isVisible: (path: string) => boolean;
  includeError?: string;
  excludeError?: string;
}

interface Field {
  match?: (path: string) => boolean;
  error?: string;
}

/**
 * A pattern is a glob when it is written like one. Typing `config` should find
 * `src/ConfigFile.ts`, the way a search box is expected to behave, while
 * `src/**` and `*.test.*` keep meaning what they have always meant.
 */
const GLOB_SYNTAX = /[*?[{]|^!/;

/**
 * Turns two comma- or newline-separated lists into one test.
 *
 * Each field is read as plain text, as globs, or as regular expressions. The
 * regex toggle decides the last. Otherwise every pattern is judged on its own,
 * so `config, *.test.ts` reads the first as text and the second as a glob
 *
 * Git paths always use forward slashes, which is why globs go through
 * picomatch's posix entry rather than the platform-sensitive default. An
 * unusable pattern reports itself and is ignored, rather than emptying the view.
 */
export function compileFilters(
  include: string,
  exclude: string,
  options: { include: MatchOptions; exclude: MatchOptions },
): FileFilter {
  const included = compile(include, options.include);
  const excluded = compile(exclude, options.exclude);

  const isVisible =
    included.match == null && excluded.match == null
      ? () => true
      : (path: string) =>
          (included.match == null || included.match(path)) &&
          (excluded.match == null || !excluded.match(path));

  return { isVisible, includeError: included.error, excludeError: excluded.error };
}

function compile(input: string, options: MatchOptions): Field {
  const patterns = input
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');

  if (patterns.length === 0) return {};

  if (options.regex) return compileRegex(patterns, options.caseSensitive);

  const globs = patterns.filter((pattern) => GLOB_SYNTAX.test(pattern));
  const texts = patterns.filter((pattern) => !GLOB_SYNTAX.test(pattern));

  const matchText = compileText(texts, options.caseSensitive);
  const matchGlob = compileGlob(globs, options.caseSensitive);
  if (matchGlob.error != null) return { error: matchGlob.error };

  const match =
    matchText == null
      ? matchGlob.match
      : matchGlob.match == null
        ? matchText
        : (path: string) => matchText(path) || matchGlob.match!(path);

  return { match };
}

function compileRegex(patterns: readonly string[], caseSensitive: boolean): Field {
  const flags = caseSensitive ? '' : 'i';
  const expressions: RegExp[] = [];

  for (const pattern of patterns) {
    try {
      expressions.push(new RegExp(pattern, flags));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return { match: (path) => expressions.some((expression) => expression.test(path)) };
}

function compileText(
  patterns: readonly string[],
  caseSensitive: boolean,
): ((path: string) => boolean) | undefined {
  if (patterns.length === 0) return undefined;

  const needles = caseSensitive ? patterns : patterns.map((pattern) => pattern.toLowerCase());
  return (path) => {
    const haystack = caseSensitive ? path : path.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  };
}

function compileGlob(
  patterns: readonly string[],
  caseSensitive: boolean,
): { match?: (path: string) => boolean; error?: string } {
  if (patterns.length === 0) return {};

  try {
    // A bare `*.test.ts` reads as "anywhere". A pattern with a slash stays
    // anchored to the whole path
    const expanded = patterns.flatMap((pattern) =>
      pattern.includes('/') ? [pattern] : [pattern, `**/${pattern}`],
    );
    const match = picomatch(expanded, { dot: true, nocase: !caseSensitive });
    return { match: (path) => match(path) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
