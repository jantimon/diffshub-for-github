import { useCallback, useEffect, useRef, type JSX, type KeyboardEvent, type MouseEvent } from 'react';

export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'j / k', action: 'Next / previous file' },
  { keys: 'n / p', action: 'Next / previous hunk' },
  { keys: 'v', action: 'Mark viewed and go to the next file' },
  { keys: 'space', action: 'Same, when the tick box has focus' },
  { keys: '/', action: 'Focus the file-tree filter' },
  { keys: '?', action: 'Shortcut help' },
  { keys: 'Esc', action: 'Close the overlay' },
];

/**
 * The shortcut table, in a modal dialog so the browser traps focus and handles
 * Escape for us. Key presses stop at the dialog: while it is open the overlay's
 * own shortcuts stay out of the way, and `?` closes the dialog alone.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  const onBackdropClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation();
    if (event.key === '?') {
      event.preventDefault();
      dialogRef.current?.close();
    }
  }, []);

  return (
    <dialog
      className="dh-help"
      ref={dialogRef}
      aria-label="Keyboard shortcuts"
      onClose={onClose}
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div className="dh-help-panel">
        <div className="dh-help-header">
          <strong>Keyboard shortcuts</strong>
          <button type="button" className="dh-help-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        <table className="dh-help-table">
          <tbody>
            {SHORTCUTS.map((shortcut) => (
              <tr key={shortcut.keys}>
                <td className="dh-help-keys">
                  <kbd>{shortcut.keys}</kbd>
                </td>
                <td className="dh-help-action">{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
