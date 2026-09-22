import { useCallback, useEffect, useRef, useState } from 'react';

import { ask } from '@/viewer/ask';
import { readSetting, writeSetting } from '@/viewer/settings';

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
  const [stored] = useState(() => read(key));
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set(stored.ids));
  // The commit the diff starts at. GitHub reports it on the same request as the
  // ticks, so it is taken from there rather than fetched again: the route that
  // carries it is over a megabyte on a large pull request
  const [baseSha, setBaseSha] = useState<string | undefined>(undefined);

  const viewedRef = useRef(viewed);
  useEffect(() => {
    viewedRef.current = viewed;
  }, [viewed]);

  const persist = useCallback(
    (ids: ReadonlySet<string>, sha: string | undefined) => {
      writeSetting(`viewed.${key}`, JSON.stringify({ sha, ids: [...ids] } satisfies Stored));
    },
    [key],
  );

  // What GitHub already has wins over the local copy, but only before the
  // reader has ticked anything: a tick made while this is in flight would
  // otherwise be thrown away when it lands
  const touched = useRef(false);
  useEffect(() => {
    void (async () => {
      const { paths, baseSha: base } = await ask('viewed');
      setBaseSha(base);
      if (touched.current || paths.length === 0) return;
      setViewed((current) => {
        const merged = new Set(current);
        for (const path of paths) merged.add(path);
        return merged;
      });
    })();
  }, []);

  // A push replaces the diff, so what was read no longer applies to it. The
  // head sha reaches the overlay a moment after it opens, so this waits for
  // the first one to arrive
  const [knownHead, setKnownHead] = useState<string | undefined>(undefined);
  if (headSha != null && knownHead == null) {
    setKnownHead(headSha);
    if (stored.sha != null && stored.sha !== headSha) setViewed(new Set());
  }

  useEffect(() => {
    if (knownHead == null) return;
    persist(viewedRef.current, knownHead);
  }, [knownHead, persist]);

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
    [headSha, persist],
  );

  // The tick lands at once and is taken back, with a toast, if GitHub refuses
  // it, so the two never quietly disagree
  const toggle = useCallback(
    (id: string, path: string) => {
      touched.current = true;
      const next = !viewedRef.current.has(id);
      apply(id, next);
      void (async () => {
        const { ok, error } = await ask('file-review', { path, viewed: next });
        if (ok) return;
        apply(id, !next);
        onFailure(error ?? `GitHub did not record ${path} as ${next ? 'viewed' : 'not viewed'}.`);
      })();
    },
    [apply, onFailure],
  );

  /**
   * Ticks off every file given that is not ticked yet, and answers with the
   * paths GitHub refused.
   *
   * GitHub takes one file per request, so they go one after another: forty at
   * once is the kind of burst that gets a session throttled
   */
  const markAll = useCallback(
    async (files: readonly { id: string; path: string }[]): Promise<string[]> => {
      touched.current = true;
      const refused: string[] = [];
      for (const { id, path } of files.filter((file) => !viewedRef.current.has(file.id))) {
        apply(id, true);
        const { ok } = await ask('file-review', { path, viewed: true });
        if (ok) continue;
        apply(id, false);
        refused.push(path);
      }
      return refused;
    },
    [apply],
  );

  return { viewed, toggle, markAll, baseSha };
}
