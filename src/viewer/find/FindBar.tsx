import { IconChevronSm, IconSearch, IconX } from '@pierre/icons';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import { MAX_MATCHES } from '@/patch/findInPatch';
import type { Find } from '@/viewer/find/useFind';

/** "3 of 128", or why there is nothing to count */
function countText(find: Find): string {
  if (find.error != null) return 'Invalid pattern';
  if (find.query === '') return '';
  if (find.matches.length === 0) return 'No matches';
  if (find.wrapped) return find.index === 0 ? 'Back to the first match' : 'Back to the last match';
  const total = find.capped ? `${MAX_MATCHES.toLocaleString()}+` : find.matches.length.toLocaleString();
  return `${(find.index + 1).toLocaleString()} of ${total}`;
}

/**
 * The find bar, floating over the top right of the diff.
 *
 * Laid out after the find widgets people already know: the switches sit in the
 * box as in VS Code, with its Alt shortcuts, and the count and the arrows follow
 * as in a browser's find bar. Escape closes the bar alone, never the overlay.
 */
export function FindBar({
  find,
  inputRef,
  onClose,
  onShowHidden,
}: {
  /** State and actions from `useFind` */
  find: Find;
  /** The box, which the overlay focuses each time find is asked for */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Closes the bar and gives the keyboard back to the diff */
  onClose: () => void;
  /** Clears the filters that hide files with matches in them */
  onShowHidden: () => void;
}): JSX.Element {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      find.step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // By key position rather than character: Alt on a Mac turns C into ç
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      const option = { KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regex' } as const;
      const chosen = option[event.code as keyof typeof option];
      if (chosen == null) return;
      event.preventDefault();
      find.toggle(chosen);
    }
  };

  const count = countText(find);
  const none = find.query !== '' && find.matches.length === 0;

  return (
    <search className="dh-find" data-dh-find={find.pending ? 'pending' : 'done'}>
      <div className="dh-find-row">
        <label className="dh-find-field" data-invalid={find.error != null} title={find.error}>
          <IconSearch size={14} />
          <input
            ref={inputRef}
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="Find in the diff"
            aria-label="Find in the diff"
            value={find.query}
            onChange={(change) => find.setQuery(change.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="dh-field-controls">
            <button
              type="button"
              className="dh-icon-button dh-toggle"
              aria-pressed={find.options.caseSensitive}
              onClick={() => find.toggle('caseSensitive')}
              title="Match case (Alt+C)"
            >
              Aa
            </button>
            <button
              type="button"
              className="dh-icon-button dh-toggle dh-find-word"
              aria-pressed={find.options.wholeWord}
              onClick={() => find.toggle('wholeWord')}
              title="Match whole word (Alt+W)"
            >
              ab
            </button>
            <button
              type="button"
              className="dh-icon-button dh-toggle"
              aria-pressed={find.options.regex}
              onClick={() => find.toggle('regex')}
              title="Use a regular expression (Alt+R)"
            >
              .*
            </button>
          </span>
        </label>
        <span className="dh-find-count" data-none={none} aria-live="polite">
          {count}
        </span>
        <span className="dh-find-rule" aria-hidden="true" />
        <button
          type="button"
          className="dh-icon-button dh-find-previous"
          onClick={() => find.step(-1)}
          disabled={find.matches.length === 0}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
        >
          <IconChevronSm size={14} />
        </button>
        <button
          type="button"
          className="dh-icon-button dh-find-next"
          onClick={() => find.step(1)}
          disabled={find.matches.length === 0}
          title="Next match (Enter)"
          aria-label="Next match"
        >
          <IconChevronSm size={14} />
        </button>
        <button
          type="button"
          className="dh-icon-button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close find"
        >
          <IconX size={14} />
        </button>
      </div>
      {find.hiddenMatches > 0 && (
        <p className="dh-find-note">
          <button type="button" className="dh-find-hidden" onClick={onShowHidden}>
            {find.hiddenMatches === 1
              ? '1 more in a hidden file'
              : `${find.hiddenMatches.toLocaleString()} more in hidden files`}
          </button>
        </p>
      )}
      {none && find.hiddenMatches === 0 && find.error == null && (
        <p className="dh-find-note">Only changed lines and code you expanded are searched.</p>
      )}
    </search>
  );
}
