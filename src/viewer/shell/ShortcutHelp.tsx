import { useEffect, useRef, type JSX } from 'react';
import { useModalDialog } from '@/viewer/shell/useModalDialog';

const IS_MAC = /mac/i.test(
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
);

/** The modifier keys as this platform prints them. The handlers accept both */
const KEY = IS_MAC
  ? { command: '⌘', option: '⌥', shift: '⇧' }
  : { command: 'Ctrl', option: 'Alt', shift: 'Shift' };

interface Shortcut {
  /** What the keys do */
  action: string;
  /** Each entry is one way to do it, its keys pressed together. More than one are alternatives */
  keys: readonly (readonly string[])[];
}

interface Group {
  title: string;
  shortcuts: readonly Shortcut[];
  /** A line under the group, for what does not fit a row */
  note?: string;
}

const GROUPS: readonly Group[] = [
  {
    title: 'Moving around',
    shortcuts: [
      { action: 'Next / previous file', keys: [['j'], ['k']] },
      { action: 'Next / previous change', keys: [['n'], ['p']] },
      { action: 'Filter the file tree', keys: [['/']] },
    ],
  },
  {
    title: 'Reviewing',
    shortcuts: [
      { action: 'Mark viewed, go to the next file', keys: [['v']] },
      { action: 'In the file tree: viewed / not viewed', keys: [['Space']] },
    ],
  },
  {
    title: 'Find',
    shortcuts: [
      { action: 'Find in the diff', keys: [[KEY.command, 'F']] },
      { action: 'Next / previous match', keys: [['Enter'], [KEY.shift, 'Enter']] },
      { action: 'Match case / whole word / regex', keys: [[KEY.option, 'C'], ['W'], ['R']] },
    ],
    note: `${KEY.command} F again in the box opens the browser's own find. ${KEY.command} G steps through matches too.`,
  },
  {
    title: 'General',
    shortcuts: [
      { action: 'This list', keys: [['?']] },
      { action: 'Close find, then the viewer', keys: [['Esc']] },
    ],
  },
];

/**
 * The shortcut table, in a modal dialog so the browser traps focus and handles
 * Escape for us. Key presses stop at the dialog: while it is open the overlay's
 * own shortcuts stay out of the way, and `?` closes the dialog alone.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // On the dialog rather than its first control, which would ring the close
  // button every time the list opens
  const close = useModalDialog(dialogRef, { focusDialog: true });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog == null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === '?') {
        event.preventDefault();
        dialog.close();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <dialog
      className="dh-help"
      ref={dialogRef}
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      onClose={onClose}
    >
      <div className="dh-help-panel">
        <div className="dh-help-header">
          <strong>Keyboard shortcuts</strong>
          <button type="button" className="dh-help-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        {GROUPS.map((group) => (
          <section key={group.title} className="dh-help-group">
            <h3>{group.title}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.action} className="dh-help-row">
                  <dt>{shortcut.action}</dt>
                  <dd>
                    {shortcut.keys.map((combination, at) => (
                      <span key={combination.join('+')} className="dh-help-combo">
                        {at > 0 && <span className="dh-help-or">/</span>}
                        {combination.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            {group.note != null && <p className="dh-help-note">{group.note}</p>}
          </section>
        ))}
      </div>
    </dialog>
  );
}
