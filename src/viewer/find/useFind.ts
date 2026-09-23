import type { CodeViewHandle } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReviewThread } from '@/shared/bridge';
import { compileQuery, findInFiles, type FindMatch, type FindOptions } from '@/patch/findInPatch';
import { useSession, type Session } from '@/viewer/state/session';
import type { ExpansionMemory } from '@/viewer/diff/expandedRegions';
import { clearMatches, paintMatches } from '@/viewer/find/paintMatches';
import { useChoice } from '@/viewer/settings';

/** Long enough that typing a word searches once, short enough to feel live */
const TYPING_PAUSE_MS = 120;

/** How long "Back to the first match" stays up after stepping past the end */
const WRAP_NOTICE_MS = 1200;

const SWITCH = ['on', 'off'] as const;

const NO_MATCHES: ReadonlyMap<string, number> = new Map();

export interface Find {
  /** Whether the bar is showing */
  open: boolean;
  /** What is in the box, which may be ahead of what was searched */
  query: string;
  /** Case, whole word and regex */
  options: FindOptions;
  /** Every match in the files on show, in the order they are drawn */
  matches: readonly FindMatch[];
  /** More matches exist than were collected */
  capped: boolean;
  /** Where the current match sits in `matches`, or -1 when there is none */
  index: number;
  /** Why the query is not a usable pattern */
  error?: string;
  /** Matches in files a filter or the whitespace toggle is hiding */
  hiddenMatches: number;
  /** The last step went past the end and came round to the other side */
  wrapped: boolean;
  /** Opens the bar, with the text to look for when there is some */
  show: (seed?: string) => void;
  /** Closes the bar and takes the marks off */
  hide: () => void;
  /** Sets what is in the box */
  setQuery: (query: string) => void;
  /** Flips one of the three switches */
  toggle: (option: keyof FindOptions) => void;
  /** Moves to the next or the previous match */
  step: (delta: 1 | -1) => void;
  /** Paints again once the rows on screen have changed */
  repaint: () => void;
  /** Searches again after a gap was opened or a file loaded in full */
  refresh: () => void;
}

interface Searched {
  /** The query as it was when the typing paused */
  text: string;
  /** The file being read when the search started, where its first match is looked for */
  fromFile: number;
}

/**
 * Find in the diff.
 *
 * It searches the parsed patch in memory, plus the collapsed code the reader
 * opened, and never downloads anything. Files hidden by a filter are counted
 * but not stepped through, so the bar can say they are there.
 */
export function useFind({
  viewerRef,
  session,
  expansion,
  currentFile,
}: {
  viewerRef: { current: CodeViewHandle<ReviewThread, undefined> | null };
  session: Session;
  expansion: ExpansionMemory;
  /** The file being read, so a new search starts from there rather than the top */
  currentFile: () => number;
}): Find {
  const [open, setOpen] = useState(false);
  const visible = useSession(session, (state) => state.visible);
  const all = useSession(session, (state) => state.all);
  // Kept while the viewer is open, never stored: what someone searched a
  // private repository for is not worth leaving behind
  const [query, setQueryState] = useState('');
  const [searched, setSearched] = useState<Searched>({ text: query, fromFile: 0 });
  const [caseChoice = 'off', setCase] = useChoice('find.case', SWITCH, 'off');
  const [wordChoice = 'off', setWord] = useChoice('find.word', SWITCH, 'off');
  const [regexChoice = 'off', setRegex] = useChoice('find.regex', SWITCH, 'off');
  const [expanded, setExpanded] = useState(() => expansion.snapshot());
  const [chosen, setChosen] = useState<{ search: Searched; match: FindMatch } | undefined>(undefined);
  const [wrapped, setWrapped] = useState(false);

  const options = useMemo<FindOptions>(
    () => ({
      caseSensitive: caseChoice === 'on',
      wholeWord: wordChoice === 'on',
      regex: regexChoice === 'on',
    }),
    [caseChoice, wordChoice, regexChoice],
  );

  // The search waits for a pause in typing. The file being read is taken then,
  // so the first match shown is the one nearest to where the reader is
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearched((before) => (before.text === query ? before : { text: query, fromFile: currentFile() }));
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, currentFile]);

  const { pattern, error } = useMemo(() => compileQuery(searched.text, options), [searched.text, options]);

  const result = useMemo(() => {
    if (!open || pattern == null) return { matches: [], capped: false, hiddenMatches: 0 };
    const expansionOf = (fileDiff: Parameters<typeof expanded.get>[0]) => expanded.get(fileDiff);
    const { matches, capped } = findInFiles(visible, pattern, expansionOf);
    const shown = new Set(visible);
    const hidden = all.filter((file) => !shown.has(file));
    const hiddenMatches = hidden.length === 0 ? 0 : findInFiles(hidden, pattern, expansionOf).matches.length;
    return { matches, capped, hiddenMatches };
  }, [open, pattern, visible, all, expanded]);

  const perFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of result.matches) counts.set(match.id, (counts.get(match.id) ?? 0) + 1);
    return counts;
  }, [result.matches]);

  // The tree shows the counts in place of the ticks while find is open
  useEffect(() => {
    session.set({ found: open ? perFile : NO_MATCHES });
  }, [open, perFile, session]);

  /**
   * The match stepped to, while it is still there. Otherwise the first match in
   * or after the file the search started from, as a browser's find does, so
   * the patch arriving or a gap opening never moves the reader somewhere else
   */
  const index = useMemo(() => {
    const { matches } = result;
    if (matches.length === 0) return -1;
    if (chosen?.search === searched) {
      const { match } = chosen;
      const kept = matches.findIndex(
        (other) =>
          other.id === match.id &&
          other.side === match.side &&
          other.lineNumber === match.lineNumber &&
          other.start === match.start,
      );
      if (kept >= 0) return kept;
    }
    const order = new Map(visible.map((file, at) => [file.item.id, at]));
    return Math.max(
      matches.findIndex((match) => (order.get(match.id) ?? 0) >= searched.fromFile),
      0,
    );
  }, [result, chosen, searched, visible]);

  const current = index >= 0 ? result.matches[index] : undefined;

  const reveal = useCallback(
    (match: FindMatch | undefined) => {
      if (match == null) return;
      viewerRef.current?.scrollTo({
        type: 'line',
        id: match.id,
        lineNumber: match.lineNumber,
        side: match.side,
        align: 'center',
      });
    },
    [viewerRef],
  );

  // A new search goes to its first match once there is one, and only once
  const revealedFor = useRef<{ search: Searched; options: FindOptions } | undefined>(undefined);
  useEffect(() => {
    if (!open || current == null) return;
    const seen = revealedFor.current;
    if (seen?.search === searched && seen.options === options) return;
    revealedFor.current = { search: searched, options };
    reveal(current);
  }, [open, current, searched, options, reveal]);

  const paintFrame = useRef(0);
  const repaint = useCallback(() => {
    cancelAnimationFrame(paintFrame.current);
    paintFrame.current = requestAnimationFrame(() => {
      const rendered = viewerRef.current?.getInstance()?.getRenderedItems() ?? [];
      paintMatches(
        rendered.map((file) => ({ id: file.id, element: file.element })),
        open ? pattern : undefined,
        current,
      );
    });
  }, [viewerRef, open, pattern, current]);

  useEffect(() => {
    repaint();
  }, [repaint]);

  useEffect(() => {
    if (!open) return undefined;
    const unsubscribe = viewerRef.current?.getInstance()?.subscribeToScroll(() => repaint());
    return () => unsubscribe?.();
  }, [open, repaint, viewerRef]);

  useEffect(() => () => clearMatches(), []);

  const wrapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const step = useCallback(
    (delta: 1 | -1) => {
      const { matches } = result;
      if (matches.length === 0) return;
      const from = index < 0 ? (delta === 1 ? -1 : 0) : index;
      const next = (from + delta + matches.length) % matches.length;
      const match = matches[next];
      if (match == null) return;
      const crossed = (delta === 1 && next < from) || (delta === -1 && next > from);
      setChosen({ search: searched, match });
      reveal(match);
      clearTimeout(wrapTimer.current);
      setWrapped(crossed);
      if (crossed) wrapTimer.current = setTimeout(() => setWrapped(false), WRAP_NOTICE_MS);
    },
    [index, result, searched, reveal],
  );

  const show = useCallback(
    (seed?: string) => {
      if (seed != null && seed !== '') {
        setQueryState(seed);
        setSearched({ text: seed, fromFile: currentFile() });
      } else {
        setSearched((before) => ({ ...before, fromFile: currentFile() }));
      }
      setExpanded(expansion.snapshot());
      setOpen(true);
    },
    [currentFile, expansion],
  );

  const hide = useCallback(() => {
    setOpen(false);
    clearMatches();
  }, []);

  const setQuery = useCallback((next: string) => setQueryState(next), []);

  const toggle = useCallback(
    (option: keyof FindOptions) => {
      if (option === 'caseSensitive') setCase(options.caseSensitive ? 'off' : 'on');
      if (option === 'wholeWord') setWord(options.wholeWord ? 'off' : 'on');
      if (option === 'regex') setRegex(options.regex ? 'off' : 'on');
    },
    [options, setCase, setWord, setRegex],
  );

  const refresh = useCallback(() => setExpanded(expansion.snapshot()), [expansion]);

  return {
    open,
    query,
    options,
    matches: result.matches,
    capped: result.capped,
    index,
    error: open ? error : undefined,
    hiddenMatches: result.hiddenMatches,
    wrapped,
    show,
    hide,
    setQuery,
    toggle,
    step,
    repaint,
    refresh,
  };
}
