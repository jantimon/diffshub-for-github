/**
 * The panel down the left: which files to show, the tree of them, and how big
 * the change is overall.
 *
 * The two filters are glob patterns rather than a search box because a review
 * is usually narrowed by shape -- everything under `src`, nothing that is a
 * test -- and that is a thing you say once, not a thing you retype.
 */

import { FileTree } from '@pierre/trees/react';
import type { CSSProperties, JSX } from 'react';

import type { DiffStats } from '@/patch/accumulator';
import { TREE_STYLE } from '@/viewer/diff/codeViewStyles';

function DiffStatsPanel({ stats }: { stats: DiffStats }) {
  const churn = stats.addedLines + stats.deletedLines;
  const addedShare = churn === 0 ? 0 : Math.round((stats.addedLines / churn) * 100);

  return (
    <section className="dh-diffstats">
      <div className="dh-diffstats-bar" role="img" aria-label={`${addedShare}% of changed lines are additions`}>
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
  onIncludeChange,
  onExcludeChange,
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
  onIncludeChange: (next: string) => void;
  onExcludeChange: (next: string) => void;
}): JSX.Element {
  return (
    <aside className="dh-sidebar" hidden={!open} style={{ width }}>
      <div className="dh-filters">
        <label className="dh-field">
          <span>files to include</span>
          <input
            value={include}
            placeholder="e.g. src/**"
            onChange={(event) => onIncludeChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        {includeError != null && <p className="dh-pattern-error">{includeError}</p>}
        <label className="dh-field">
          <span>files to exclude</span>
          <input
            value={exclude}
            placeholder="e.g. *.test.*, *.snap"
            onChange={(event) => onExcludeChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        {excludeError != null && <p className="dh-pattern-error">{excludeError}</p>}
        {hiddenCount > 0 && (
          <p className="dh-hidden">{hiddenCount.toLocaleString()} files hidden</p>
        )}
        {spacingOnlyCount > 0 && (
          <p className="dh-hidden">
            {spacingOnlyCount.toLocaleString()} changed only in spacing
          </p>
        )}
      </div>
      <FileTree className="dh-tree" model={model} style={{ ...treeSurface, ...TREE_STYLE }} />
      <DiffStatsPanel stats={stats} />
    </aside>
  );
}
