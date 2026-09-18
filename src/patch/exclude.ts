import picomatch from 'picomatch/posix';

export interface ExcludeMatcher {
  isExcluded: (path: string) => boolean;
  error?: string;
}

const NEVER_EXCLUDED: ExcludeMatcher = { isExcluded: () => false };

/**
 * Turns a comma- or newline-separated list of globs into one matcher.
 *
 * Git paths always use forward slashes, which is why this uses picomatch's
 * posix entry rather than the platform-sensitive default. An unusable pattern
 * filters nothing and reports itself, rather than emptying the view.
 */
export function compileExcludes(input: string): ExcludeMatcher {
  const patterns = input
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');

  if (patterns.length === 0) return NEVER_EXCLUDED;

  try {
    const match = picomatch(patterns, { dot: true, basename: false });
    return { isExcluded: (path) => match(path) };
  } catch (error) {
    return { ...NEVER_EXCLUDED, error: error instanceof Error ? error.message : String(error) };
  }
}
