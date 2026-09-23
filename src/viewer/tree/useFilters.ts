import { useCallback, useEffect, useMemo, useState } from 'react';

import { compileFilters, type FileFilter } from '@/patch/filters';
import { readSetting, writeSetting } from '@/viewer/settings';

/** How long typing pauses before the filter applies, so every keystroke does not redraw the diff */
const TYPING_PAUSE_MS = 250;

/** The two filter fields as the sidebar draws them */
export interface FilterFields {
  /** What is in the include box, which may be ahead of what applies */
  include: string;
  /** What is in the exclude box */
  exclude: string;
  includeCase: boolean;
  includeRegex: boolean;
  excludeCase: boolean;
  excludeRegex: boolean;
  setInclude: (next: string) => void;
  setExclude: (next: string) => void;
  toggleIncludeCase: () => void;
  toggleIncludeRegex: () => void;
  toggleExcludeCase: () => void;
  toggleExcludeRegex: () => void;
}

function readSwitch(key: string): boolean {
  return readSetting(key, '') === 'on';
}

/**
 * The include and exclude patterns, their case and regex switches, and the
 * filter they compile to. All of it is remembered for the next pull request,
 * and the patterns apply once typing pauses.
 */
export function useFilters(): { fields: FilterFields; filter: FileFilter; clear: () => void } {
  const [include, setInclude] = useState(() => readSetting('include', ''));
  const [exclude, setExclude] = useState(() => readSetting('exclude', ''));
  const [applied, setApplied] = useState({ include, exclude });
  const [includeCase, setIncludeCase] = useState(() => readSwitch('includeCase'));
  const [includeRegex, setIncludeRegex] = useState(() => readSwitch('includeRegex'));
  const [excludeCase, setExcludeCase] = useState(() => readSwitch('excludeCase'));
  const [excludeRegex, setExcludeRegex] = useState(() => readSwitch('excludeRegex'));

  useEffect(() => {
    writeSetting('includeCase', includeCase ? 'on' : '');
    writeSetting('includeRegex', includeRegex ? 'on' : '');
    writeSetting('excludeCase', excludeCase ? 'on' : '');
    writeSetting('excludeRegex', excludeRegex ? 'on' : '');
  }, [includeCase, includeRegex, excludeCase, excludeRegex]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied({ include, exclude });
      writeSetting('include', include);
      writeSetting('exclude', exclude);
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [include, exclude]);

  const filter = useMemo(
    () =>
      compileFilters(applied.include, applied.exclude, {
        include: { caseSensitive: includeCase, regex: includeRegex },
        exclude: { caseSensitive: excludeCase, regex: excludeRegex },
      }),
    [applied, includeCase, includeRegex, excludeCase, excludeRegex],
  );

  const clear = useCallback(() => {
    setInclude('');
    setExclude('');
  }, []);

  const fields: FilterFields = {
    include,
    exclude,
    includeCase,
    includeRegex,
    excludeCase,
    excludeRegex,
    setInclude,
    setExclude,
    toggleIncludeCase: () => setIncludeCase((on) => !on),
    toggleIncludeRegex: () => setIncludeRegex((on) => !on),
    toggleExcludeCase: () => setExcludeCase((on) => !on),
    toggleExcludeRegex: () => setExcludeRegex((on) => !on),
  };

  return { fields, filter, clear };
}
