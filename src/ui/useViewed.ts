import { useCallback, useEffect, useRef, useState } from 'react';

import { requestFileReview } from './reviewFile';
import { readSetting, writeSetting } from './storage';

/**
 * Which files have been ticked off.
 *
 * The tick goes to GitHub, so its own Files-changed tab agrees. It is also kept
 * in this browser under the head commit, which is what the overlay shows while
 * it is open -- GitHub offers no way to read the existing state back.
 */
export function useViewed(key: string, onFailure: (message: string) => void) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());
  const loadedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    try {
      const stored = JSON.parse(readSetting(`viewed.${key}`, '[]')) as unknown;
      setViewed(new Set(Array.isArray(stored) ? (stored as string[]) : []));
    } catch {
      setViewed(new Set());
    }
  }, [key]);

  const apply = useCallback(
    (id: string, next: boolean) => {
      setViewed((current) => {
        const updated = new Set(current);
        if (next) updated.add(id);
        else updated.delete(id);
        writeSetting(`viewed.${key}`, JSON.stringify([...updated]));
        return updated;
      });
    },
    [key]
  );

  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;

  // The tick lands at once and is taken back if GitHub refuses it, so the two
  // never quietly disagree.
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
