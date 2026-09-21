import { useCallback, useEffect, useRef, useState } from 'react';

import { ask } from './ask';
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
 * GitHub is the source of truth: what it already has marked is read once when
 * the overlay opens, and every tick is sent to it, so its own Files-changed tab
 * and this one agree in both directions. A copy is kept in this browser so the
 * list is there before GitHub answers.
 *
 * Storage is keyed by pull request rather than by revision, because the head
 * commit arrives from the page a moment after the overlay opens. Keying on it
 * would reload this state mid-session and throw away a tick made in between.
 * The revision is stored alongside instead, and a push clears the list.
 */
export function useViewed(key: string, headSha: string | undefined, onFailure: (message: string) => void) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set(read(key).ids));
  // The commit the diff starts at. GitHub reports it on the same request as the
  // ticks, so it is taken from there rather than fetched again: the route that
  // carries it is over a megabyte on a large pull request.
  const [baseSha, setBaseSha] = useState<string | undefined>(undefined);
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;

  const persist = useCallback(
    (ids: ReadonlySet<string>, sha: string | undefined) => {
      writeSetting(`viewed.${key}`, JSON.stringify({ sha, ids: [...ids] } satisfies Stored));
    },
    [key]
  );

  // What GitHub already has wins over the local copy, but only before the
  // reader has ticked anything: a tick made while this is in flight would
  // otherwise be thrown away when it lands.
  const touched = useRef(false);
  useEffect(() => {
    void ask('viewed').then(({ paths, baseSha: base }) => {
      setBaseSha(base);
      if (touched.current || paths.length === 0) return;
      setViewed((current) => {
        const merged = new Set(current);
        for (const path of paths) merged.add(path);
        return merged;
      });
    });
  }, [key]);

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
      touched.current = true;
      const next = !viewedRef.current.has(id);
      apply(id, next);
      void ask('file-review', { path, viewed: next }).then(({ ok, error }) => {
        if (ok) return;
        apply(id, !next);
        onFailure(error ?? `GitHub did not record ${path} as ${next ? 'viewed' : 'not viewed'}.`);
      });
    },
    [apply, onFailure]
  );

  return { viewed, toggle, baseSha };
}
