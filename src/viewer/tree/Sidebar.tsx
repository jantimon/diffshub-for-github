/**
 * The panel down the left: which files to show, the tree of them, and how big
 * the change is overall.
 *
 * A review is usually narrowed by shape -- everything under `src`, nothing
 * that is a test -- so the two filters keep their globs, and that is a thing
 * you say once rather than retype. They also read plain words and regular
 * expressions, so narrowing by name costs no ceremony either.
 */

import { FileTree } from '@pierre/trees/react';
import { IconX } from '@pierre/icons';
import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { DiffStats } from '@/patch/accumulator';
import { TREE_STYLE } from '@/viewer/tree/treeStyles';

/**
 * What sits inside the box: a clear button that appears only when there is
 * something to clear, then the two switches a search box is expected to carry.
 * Whole-word is deliberately absent, since a path has no words to bound.
 *
 * Clear is an icon and the switches are labels, it is separated by a rule, and
 * it is missing whenever the field is empty -- three reasons it cannot be read
 * as a third mode.
 */
function FieldControls({
  value,
  onClear,
  caseSensitive,
  onCase,
  regex,
  onRegex,
}: {
  value: string;
  onClear: () => void;
  caseSensitive: boolean;
  onCase: () => void;
  regex: boolean;
  onRegex: () => void;
}) {
  return (
    <div className="dh-field-controls">
      {value !== '' && (
        <>
          <button
            type="button"
            className="dh-icon-button dh-clear"
            onClick={onClear}
            title="Clear (Esc)"
            aria-label="Clear"
          >
            <IconX size={12} />
          </button>
          <span className="dh-field-rule" />
        </>
      )}
      <button
        type="button"
        className="dh-icon-button dh-toggle"
        aria-pressed={caseSensitive}
        onClick={onCase}
        title="Match case"
      >
        Aa
      </button>
      <button
        type="button"
        className="dh-icon-button dh-toggle"
        aria-pressed={regex}
        onClick={onRegex}
        title="Use a regular expression"
      >
        .*
      </button>
    </div>
  );
}

/**
 * How big the change is overall.
 *
 * The bar is decoration and is hidden from screen readers: the figures under
 * it carry the same split in numbers, so announcing both says it twice.
 */
function DiffStatsPanel({ stats }: { stats: DiffStats }) {
  const churn = stats.addedLines + stats.deletedLines;
  const addedShare = churn === 0 ? 0 : Math.round((stats.addedLines / churn) * 100);

  return (
    <section className="dh-diffstats">
      <div className="dh-diffstats-bar" aria-hidden="true">
        <span className="dh-diffstats-added" style={{ width: `${addedShare}%` }} />
        <span className="dh-diffstats-deleted" style={{ width: `${100 - addedShare}%` }} />
      </div>
      <div className="dh-diffstats-figures">
        <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
        <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
      </div>
      <div className="dh-diffstats-totals">
        <span>{stats.fileCount.toLocaleString()} files</span>
        <span>{stats.totalLines.toLocaleString()} lines</span>
      </div>
    </section>
  );
}

/**
 * `Esc` in a filter field clears it, and in an empty one gives the key back to
 * the overlay by blurring, so a second press closes the viewer as it always did
 */
function clearOnEscape(event: ReactKeyboardEvent<HTMLInputElement>, clear: () => void): void {
  if (event.key !== 'Escape') return;
  if (event.currentTarget.value === '') return event.currentTarget.blur();
  event.preventDefault();
  clear();
}

export function Sidebar({
  open,
  width,
  model,
  treeSurface,
  stats,
  include,
  exclude,
  includeError,
  excludeError,
  hiddenCount,
  spacingOnlyCount,
  includeCase,
  includeRegex,
  excludeCase,
  excludeRegex,
  onIncludeChange,
  onExcludeChange,
  onIncludeCase,
  onIncludeRegex,
  onExcludeCase,
  onExcludeRegex,
}: {
  open: boolean;
  width: number;
  model: Parameters<typeof FileTree>[0]['model'];
  treeSurface: CSSProperties;
  stats: DiffStats;
  include: string;
  exclude: string;
  includeError?: string;
  excludeError?: string;
  hiddenCount: number;
  spacingOnlyCount: number;
  includeCase: boolean;
  includeRegex: boolean;
  excludeCase: boolean;
  excludeRegex: boolean;
  onIncludeChange: (next: string) => void;
  onExcludeChange: (next: string) => void;
  onIncludeCase: () => void;
  onIncludeRegex: () => void;
  onExcludeCase: () => void;
  onExcludeRegex: () => void;
}): JSX.Element {
  return (
    <aside className="dh-sidebar" hidden={!open} style={{ width }}>
      <div className="dh-filters">
        <div className="dh-field">
          <label className="dh-field-label" htmlFor="dh-include">
            files to include
          </label>
          <div className="dh-field-box">
            <input
              id="dh-include"
              value={include}
              placeholder="e.g. config, src/**"
              onChange={(event) => onIncludeChange(event.target.value)}
              onKeyDown={(event) => clearOnEscape(event, () => onIncludeChange(''))}
              spellCheck={false}
            />
            <FieldControls
              value={include}
              onClear={() => onIncludeChange('')}
              caseSensitive={includeCase}
              onCase={onIncludeCase}
              regex={includeRegex}
              onRegex={onIncludeRegex}
            />
          </div>
        </div>
        {includeError != null && <p className="dh-pattern-error">{includeError}</p>}
        <div className="dh-field">
          <label className="dh-field-label" htmlFor="dh-exclude">
            files to exclude
          </label>
          <div className="dh-field-box">
            <input
              id="dh-exclude"
              value={exclude}
              placeholder="e.g. *.test.*, *.snap"
              onChange={(event) => onExcludeChange(event.target.value)}
              onKeyDown={(event) => clearOnEscape(event, () => onExcludeChange(''))}
              spellCheck={false}
            />
            <FieldControls
              value={exclude}
              onClear={() => onExcludeChange('')}
              caseSensitive={excludeCase}
              onCase={onExcludeCase}
              regex={excludeRegex}
              onRegex={onExcludeRegex}
            />
          </div>
        </div>
        {excludeError != null && <p className="dh-pattern-error">{excludeError}</p>}
        {hiddenCount > 0 && <p className="dh-hidden">{hiddenCount.toLocaleString()} files hidden</p>}
        {spacingOnlyCount > 0 && (
          <p className="dh-hidden">{spacingOnlyCount.toLocaleString()} changed only in spacing</p>
        )}
      </div>
      <FileTree className="dh-tree" model={model} style={{ ...treeSurface, ...TREE_STYLE }} />
      <DiffStatsPanel stats={stats} />
    </aside>
  );
}
