import { useSyncExternalStore } from 'react';

import type { DiffStats, ParsedFile } from '@/patch/accumulator';

/**
 * What the viewer knows about the pull request it is showing, in one place
 * outside React.
 *
 * The file tree and the diff library call back into this code outside React's
 * render: the tree decorates its rows, the diff draws each file's header, and
 * the keyboard handlers run whenever a key is pressed. Each of them needs the
 * current value, not the one from the render that created the callback. So the
 * state lives here, those callbacks read `get()`, and React components
 * subscribe to the part they draw with `useSession`.
 */
export interface SessionState {
  /** Whether the patch is still arriving, all here, or could not be read */
  phase: 'loading' | 'ready' | 'error';
  /** Why the patch could not be read */
  error?: string;
  /** Every parsed file, in patch order, whatever the filters say */
  all: readonly ParsedFile[];
  /** The files the filters and the whitespace switch let through, in patch order */
  visible: readonly ParsedFile[];
  /** Each visible file's diff item, by its path */
  pathToItemId: ReadonlyMap<string, string>;
  /** Added and deleted lines, and counts, over the visible files */
  stats: DiffStats;
  /** Files a filter hides */
  hiddenCount: number;
  /** Files held back because nothing in them changed but spacing */
  spacingOnlyCount: number;
  /** Why the include pattern cannot be used */
  includeError?: string;
  /** Why the exclude pattern cannot be used */
  excludeError?: string;
  /** Paths of the files ticked off as viewed */
  viewed: ReadonlySet<string>;
  /** The commit the diff starts at, once GitHub has said */
  baseSha?: string;
  /** Matches per file id while find is open, which the tree shows instead of the tick */
  found: ReadonlyMap<string, number>;
}

export interface Session {
  get: () => SessionState;
  /** Replaces some of the state and tells every subscriber */
  set: (change: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_STATS: DiffStats = { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 };

export function createSession(viewed: ReadonlySet<string> = new Set()): Session {
  let state: SessionState = {
    phase: 'loading',
    all: [],
    visible: [],
    pathToItemId: new Map(),
    stats: EMPTY_STATS,
    hiddenCount: 0,
    spacingOnlyCount: 0,
    viewed,
    found: new Map(),
  };
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set(change) {
      const next = typeof change === 'function' ? change(state) : change;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * One part of the session, redrawn when it changes. `select` must answer a
 * value already in the state, or one it derives the same way each time, so
 * that an unchanged part compares equal and nothing redraws
 */
export function useSession<T>(session: Session, select: (state: SessionState) => T): T {
  return useSyncExternalStore(session.subscribe, () => select(session.get()));
}
