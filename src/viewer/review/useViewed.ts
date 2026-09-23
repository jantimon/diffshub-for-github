import { useCallback, useEffect, useRef } from 'react';

import { ask } from '@/viewer/bridge/ask';
import { readSetting, writeSetting } from '@/viewer/settings';
import type { Session } from '@/viewer/state/session';

interface Stored {
  sha?: string;
  paths: string[];
}

/**
 * The files ticked off on this pull request when the viewer last had it open,
 * or none when a push has happened since: what was read no longer applies to
 * the new diff. Kept by path. Entries written as `ids` are read as paths, which
 * they were for every file listed once in its patch.
 */
export function storedViewed(key: string, headSha: string | undefined): ReadonlySet<string> {
  try {
    const value = JSON.parse(readSetting(`viewed.${key}`, '{}')) as Partial<Stored> & { ids?: string[] };
    if (value?.sha != null && headSha != null && value.sha !== headSha) return new Set();
    const paths = Array.isArray(value?.paths) ? value.paths : Array.isArray(value?.ids) ? value.ids : [];
    return new Set(paths);
  } catch {
    return new Set();
  }
}

/**
 * Keeps the viewed ticks in step with GitHub.
 *
 * GitHub is the source of truth: what it already has marked is read once when
 * the viewer opens, and every tick is sent to it, so its own Files-changed tab
 * and this one agree in both directions. A copy is kept in this browser, so the
 * ticks are there before GitHub answers.
 */
export function useViewed(
  session: Session,
  key: string,
  headSha: string | undefined,
  onFailure: (message: string) => void,
): { toggle: (path: string) => void; markAll: (paths: readonly string[]) => Promise<string[]> } {
  // Every change is kept, against the commit it was made on
  useEffect(() => {
    let written = session.get().viewed;
    const persist = (): void => {
      const { viewed } = session.get();
      if (viewed === written) return;
      written = viewed;
      writeSetting(`viewed.${key}`, JSON.stringify({ sha: headSha, paths: [...viewed] } satisfies Stored));
    };
    return session.subscribe(persist);
  }, [session, key, headSha]);

  // What GitHub already has wins over the local copy, but only before the
  // reader has ticked anything: a tick made while this is in flight would
  // otherwise be thrown away when it lands
  const touched = useRef(false);
  useEffect(() => {
    void (async () => {
      const { paths, baseSha } = await ask('viewed');
      session.set({ baseSha });
      if (touched.current || paths.length === 0) return;
      session.set(({ viewed }) => ({ viewed: new Set([...viewed, ...paths]) }));
    })();
  }, [session]);

  const apply = useCallback(
    (path: string, next: boolean) => {
      session.set(({ viewed }) => {
        const updated = new Set(viewed);
        if (next) updated.add(path);
        else updated.delete(path);
        return { viewed: updated };
      });
    },
    [session],
  );

  // The tick lands at once and is taken back, with a toast, if GitHub refuses
  // it, so the two never quietly disagree
  const toggle = useCallback(
    (path: string) => {
      touched.current = true;
      const next = !session.get().viewed.has(path);
      apply(path, next);
      void (async () => {
        const { ok, error } = await ask('file-review', { path, viewed: next });
        if (ok) return;
        apply(path, !next);
        onFailure(error ?? `GitHub did not record ${path} as ${next ? 'viewed' : 'not viewed'}.`);
      })();
    },
    [apply, onFailure, session],
  );

  /**
   * Ticks off every path given that is not ticked yet, and answers with the
   * ones GitHub refused. GitHub takes one file per request, so they go one
   * after another: forty at once is the kind of burst that gets a session
   * throttled
   */
  const markAll = useCallback(
    async (paths: readonly string[]): Promise<string[]> => {
      touched.current = true;
      const refused: string[] = [];
      for (const path of paths.filter((one) => !session.get().viewed.has(one))) {
        apply(path, true);
        const { ok } = await ask('file-review', { path, viewed: true });
        if (ok) continue;
        apply(path, false);
        refused.push(path);
      }
      return refused;
    },
    [apply, session],
  );

  return { toggle, markAll };
}
