import { useCallback, useEffect, useRef } from 'react';

import { ask } from '@/viewer/bridge/ask';
import { readSetting, writeSetting } from '@/viewer/settings';
import type { Session } from '@/viewer/state/session';

/**
 * How long after one read of GitHub's ticks the next may happen. The read is the
 * whole file list, over a megabyte on a large pull request, so coming back to
 * the viewer does not ask every time
 */
const READ_AGAIN_AFTER_MS = 60_000;

interface Stored {
  sha?: string;
  paths: string[];
}

/**
 * The files ticked off on this pull request when the viewer last had it open,
 * or none when a push has happened since: what was read no longer applies to
 * the new diff. Kept by path.
 */
export function storedViewed(key: string, headSha: string | undefined): ReadonlySet<string> {
  try {
    const value = JSON.parse(readSetting(`viewed.${key}`, '{}')) as Partial<Stored>;
    if (value?.sha != null && headSha != null && value.sha !== headSha) return new Set();
    return new Set(Array.isArray(value?.paths) ? value.paths : []);
  } catch {
    return new Set();
  }
}

/**
 * Keeps the viewed ticks in step with GitHub.
 *
 * GitHub is the source of truth: what it has marked is read when the viewer
 * opens and again when the reader comes back to it, and every tick is sent to
 * it, so its own Files-changed tab and this one agree in both directions. A
 * copy is kept in this browser, so the ticks are there before GitHub answers,
 * and stay when it does not.
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

  /**
   * `localEdits` counts every tick made here, `writesInFlight` the ticks
   * GitHub has not answered yet. What GitHub answers replaces the ticks here,
   * unless a tick was made while the read was on its way or is still being
   * sent: that tick is newer than the answer, and would be thrown away.
   *
   * A read skipped this way is not retried. The next comes on the reader's return
   */
  const localEdits = useRef(0);
  const writesInFlight = useRef(0);
  useEffect(() => {
    let lastRead = 0;
    const read = async (): Promise<void> => {
      lastRead = Date.now();
      const before = localEdits.current;
      const { paths, baseSha, error } = await ask('viewed');
      if (baseSha != null) session.set({ baseSha });
      if (error != null || localEdits.current !== before || writesInFlight.current > 0) return;
      if (!sameSet(session.get().viewed, paths)) session.set({ viewed: new Set(paths) });
    };
    void read();

    // Back from another tab, or the overlay opened again over GitHub's own
    // page, where either could have changed the ticks
    const onReturn = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead > READ_AGAIN_AFTER_MS) void read();
    };
    addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [session]);

  const apply = useCallback(
    (path: string, next: boolean) => {
      localEdits.current += 1;
      session.set(({ viewed }) => {
        const updated = new Set(viewed);
        if (next) updated.add(path);
        else updated.delete(path);
        return { viewed: updated };
      });
    },
    [session],
  );

  const send = useCallback(async (path: string, viewed: boolean) => {
    writesInFlight.current += 1;
    try {
      return await ask('file-review', { path, viewed });
    } finally {
      writesInFlight.current -= 1;
    }
  }, []);

  // The tick lands at once and is taken back, with a toast, if GitHub refuses
  // it, so the two never quietly disagree
  const toggle = useCallback(
    (path: string) => {
      const next = !session.get().viewed.has(path);
      apply(path, next);
      void (async () => {
        const { ok, error } = await send(path, next);
        if (ok) return;
        apply(path, !next);
        onFailure(error ?? `GitHub did not record ${path} as ${next ? 'viewed' : 'not viewed'}.`);
      })();
    },
    [apply, onFailure, send, session],
  );

  /**
   * Ticks off every path given that is not ticked yet, and answers with the
   * ones GitHub refused. GitHub takes one file per request, so they go one
   * after another: forty at once is the kind of burst that gets a session
   * throttled
   */
  const markAll = useCallback(
    async (paths: readonly string[]): Promise<string[]> => {
      const refused: string[] = [];
      for (const path of paths.filter((one) => !session.get().viewed.has(one))) {
        apply(path, true);
        const { ok } = await send(path, true);
        if (ok) continue;
        apply(path, false);
        refused.push(path);
      }
      return refused;
    },
    [apply, send, session],
  );

  return { toggle, markAll };
}

function sameSet(set: ReadonlySet<string>, list: readonly string[]): boolean {
  return set.size === new Set(list).size && list.every((item) => set.has(item));
}
