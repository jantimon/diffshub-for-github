import { useCallback, useEffect, useRef, useState } from 'react';

import { readSetting, writeSetting } from './storage';

/**
 * Which files have been ticked off, kept per pull request revision so a push
 * clears them the way GitHub does.
 *
 * This lives in the browser and is not written back to GitHub, so GitHub's own
 * Files-changed tab does not see it.
 */
export function useViewed(key: string) {
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

  const toggle = useCallback(
    (id: string) => {
      setViewed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        writeSetting(`viewed.${key}`, JSON.stringify([...next]));
        return next;
      });
    },
    [key]
  );

  return { viewed, toggle };
}
