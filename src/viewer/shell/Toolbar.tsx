/**
 * The bar across the top: who and what this is, how the reading is going, and
 * every control that changes the whole view rather than one file.
 *
 * Each control carries a `data-dh-action` so the browser tests can name the one
 * they mean. Going by position broke every time a button was added.
 */

import {
  IconBrandGithub,
  IconCheck,
  IconColorDark,
  IconColorLight,
  IconComment,
  IconDiffSplit,
  IconDiffUnified,
  IconParagraph,
  IconQuestion,
  IconSearch,
  IconSidebarLeft,
  IconX,
} from '@pierre/icons';
import type { JSX } from 'react';

import type { DiffStats } from '@/patch/accumulator';
import { filesUrl, GITHUB_ORIGIN, type PullRequestRef } from '@/pullRequest';
import type { PageInfo } from '@/bridge';

export function Toolbar({
  pr,
  page,
  stats,
  viewedOnShow,
  loading,
  sidebarOpen,
  diffStyle,
  themeType,
  ignoreWhitespace,
  hideComments,
  onToggleSidebar,
  onToggleWhitespace,
  onToggleComments,
  onToggleLayout,
  onToggleTheme,
  onFinishReview,
  onShowHelp,
  onFind,
  onClose,
}: {
  pr: PullRequestRef;
  page: PageInfo;
  stats: DiffStats;
  viewedOnShow: number;
  loading: boolean;
  sidebarOpen: boolean;
  diffStyle: 'split' | 'unified';
  themeType: 'light' | 'dark';
  ignoreWhitespace: boolean;
  hideComments: boolean;
  onToggleSidebar: () => void;
  onToggleWhitespace: () => void;
  onToggleComments: () => void;
  onToggleLayout: () => void;
  onToggleTheme: () => void;
  onFinishReview: () => void;
  onShowHelp: () => void;
  onFind: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <header className="dh-header">
      <button
        type="button"
        className="dh-icon-button"
        data-dh-action="sidebar"
        onClick={onToggleSidebar}
        aria-pressed={sidebarOpen}
        title={sidebarOpen ? 'Hide the file tree' : 'Show the file tree'}
      >
        <IconSidebarLeft size={16} />
      </button>
      <div className="dh-identity">
        {page.author != null && (
          <a
            className="dh-author"
            href={`${GITHUB_ORIGIN}/${page.author}`}
            target="_top"
            title={`Opened by ${page.author} — open their profile`}
          >
            <img src={`${GITHUB_ORIGIN}/${page.author}.png?size=64`} alt={`Opened by ${page.author}`} />
          </a>
        )}
        <strong>
          {pr.owner}/{pr.repo} #{pr.number}
        </strong>
        <span className="dh-title">{page.title}</span>
      </div>
      <div className="dh-stats">
        <span>
          {viewedOnShow.toLocaleString()} / {stats.fileCount.toLocaleString()} viewed
        </span>
        <span className="dh-add">+{stats.addedLines.toLocaleString()}</span>
        <span className="dh-del">−{stats.deletedLines.toLocaleString()}</span>
        {loading && <span className="dh-loading">loading…</span>}
      </div>
      <div className="dh-actions">
        <button
          type="button"
          className="dh-primary"
          data-dh-action="review"
          onClick={onFinishReview}
          title="Finish your review"
        >
          <IconCheck size={15} />
          Finish review
        </button>
        <span className="dh-actions-divider" aria-hidden="true" />
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="find"
          onClick={onFind}
          title="Find in the diff (⌘F)"
        >
          <IconSearch size={16} />
        </button>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="whitespace"
          aria-pressed={ignoreWhitespace}
          onClick={onToggleWhitespace}
          title={
            ignoreWhitespace
              ? 'Ignoring files that changed only in spacing — click to show them'
              : 'Hide files that changed only in spacing'
          }
        >
          <IconParagraph size={16} />
        </button>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="comments"
          aria-pressed={hideComments}
          onClick={onToggleComments}
          title={
            hideComments
              ? 'Reading only — click to bring the conversations back'
              : 'Hide the conversations and the way to start one'
          }
        >
          <IconComment size={16} />
        </button>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="layout"
          onClick={onToggleLayout}
          title={diffStyle === 'split' ? 'Split view — switch to unified' : 'Unified view — switch to split'}
        >
          {diffStyle === 'split' ? <IconDiffSplit size={16} /> : <IconDiffUnified size={16} />}
        </button>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="theme"
          onClick={onToggleTheme}
          title={themeType === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {themeType === 'dark' ? <IconColorLight size={16} /> : <IconColorDark size={16} />}
        </button>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="help"
          onClick={onShowHelp}
          title="Keyboard shortcuts (?)"
        >
          <IconQuestion size={16} />
        </button>
        <a
          className="dh-icon-button"
          data-dh-action="github"
          href={filesUrl(pr)}
          target="_top"
          title="Open GitHub's own Files changed view"
        >
          <IconBrandGithub size={16} />
        </a>
        <button
          type="button"
          className="dh-icon-button"
          data-dh-action="close"
          onClick={onClose}
          title="Close (Esc)"
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  );
}
