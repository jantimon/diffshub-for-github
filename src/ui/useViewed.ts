import { useCallback, useEffect, useRef, useState } from 'react';

import { requestFileReview } from './reviewFile';
import { readSetting, writeSetting } from './storage';

interface Stored {
  sha?: string;
  ids: string[];
}

function read(key: string): Stored {
  try {
    const value = JSON.parse(readSetting(`viewed.${key}`, '{}')) as Partial<Stored>;
    return { sha: value?.sha, ids: Array.isArray(value?.ids) ? value.ids : [] };
  } catch {
    return { ids: [] };
  }
}

/**
 * Which files have been ticked off.
 *
 * The tick goes to GitHub, so its own Files-changed tab agrees. It is also kept
 * in this browser, which is what the overlay shows while it is open -- GitHub
 * offers no way to read the existing state back.
 *
 * Storage is keyed by pull request rather than by revision, because the head
 * commit arrives from the page a moment after the overlay opens. Keying on it
 * would reload this state mid-session and throw away a tick made in between.
 * The revision is stored alongside instead, and a push clears the list.
 */
export function useViewed(key: string, headSha: string | undefined, onFailure: (message: string) => void) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set(read(key).ids));
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;

  const persist = useCallback(
    (ids: ReadonlySet<string>, sha: string | undefined) => {
      writeSetting(`viewed.${key}`, JSON.stringify({ sha, ids: [...ids] } satisfies Stored));
    },
    [key]
  );

  // A push replaces the diff, so what was read no longer applies to it.
  const checkedRevision = useRef(false);
  useEffect(() => {
    if (headSha == null || checkedRevision.current) return;
    checkedRevision.current = true;
    const stored = read(key);
    if (stored.sha != null && stored.sha !== headSha) {
      setViewed(new Set());
      persist(new Set(), headSha);
      return;
    }
    persist(viewedRef.current, headSha);
  }, [headSha, key, persist]);

  const apply = useCallback(
    (id: string, next: boolean) => {
      setViewed((current) => {
        const updated = new Set(current);
        if (next) updated.add(id);
        else updated.delete(id);
        persist(updated, headSha);
        return updated;
      });
    },
    [headSha, persist]
  );

  // The tick lands at once and is taken back, with a toast, if GitHub refuses
  // it, so the two never quietly disagree.
  const toggle = useCallback(
    (id: string, path: string) => {
      const next = !viewedRef.current.has(id);
      apply(id, next);
      void requestFileReview(path, next).then((ok) => {
        if (ok) return;
        apply(id, !next);
        onFailure(`GitHub did not record ${path} as ${next ? 'viewed' : 'not viewed'}.`);
      });
    },
    [apply, onFailure]
  );

  return { viewed, toggle };
}
