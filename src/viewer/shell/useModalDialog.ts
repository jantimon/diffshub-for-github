import { useCallback, useEffect, type RefObject } from 'react';

/**
 * Opens a `<dialog>` as a modal when it mounts, and closes it on a click on the
 * backdrop, which lands on the dialog itself. Esc is the keyboard way out, and
 * the browser handles that one. Answers a function that closes it.
 *
 * `focusDialog` puts the keyboard on the dialog rather than its first control,
 * for a dialog whose first control would otherwise open ringed.
 */
export function useModalDialog(
  dialogRef: RefObject<HTMLDialogElement | null>,
  { focusDialog = false }: { focusDialog?: boolean } = {},
): () => void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog == null) return undefined;
    dialog.showModal();
    if (focusDialog) dialog.focus();

    const onBackdropClick = (event: Event): void => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener('click', onBackdropClick);
    return () => dialog.removeEventListener('click', onBackdropClick);
  }, [dialogRef, focusDialog]);

  return useCallback(() => dialogRef.current?.close(), [dialogRef]);
}
