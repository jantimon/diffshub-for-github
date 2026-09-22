/**
 * Remembering a choice between visits.
 *
 * The viewer runs on the extension's own origin, so this storage is the
 * extension's alone: nothing here is visible to github.com, and nothing here
 * is sent anywhere. It holds preferences only -- which way the diff is laid
 * out, how wide the sidebar is, what the filters were set to.
 *
 * Every read and write is guarded. Storage can be blocked outright, and in a
 * partitioned or private window even reading it throws, which is not worth
 * failing the whole viewer over: a forgotten preference is a small loss.
 */

import { useCallback, useState } from 'react';

const PREFIX = 'diffshub-for-github.';

export function readSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // A blocked storage partition is not worth failing the overlay over.
  }
}

/** A setting held as the text it is stored as. */
export function useSetting(key: string, fallback: string): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readSetting(key, fallback));
  const set = useCallback(
    (next: string) => {
      setValue(next);
      writeSetting(key, next);
    },
    [key],
  );
  return [value, set];
}

/**
 * A setting that is one of a few known values.
 *
 * Anything else that comes back -- an older version's spelling, or a value
 * edited by hand -- falls back rather than being trusted, so a stored setting
 * can never put the viewer into a state it has no code for.
 */
export function useChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
): [T | undefined, (next: T) => void] {
  const [value, setValue] = useState<T | undefined>(() => {
    const stored = readSetting(key, '') as T;
    return allowed.includes(stored) ? stored : fallback;
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeSetting(key, next);
    },
    [key],
  );
  return [value, set];
}
