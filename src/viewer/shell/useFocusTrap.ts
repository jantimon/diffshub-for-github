import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select, [tabindex]';

/**
 * Keeps Tab inside the overlay.
 *
 * Past the viewer's last control the browser would move on to github.com,
 * behind the overlay, where nothing can be seen and Cmd+F opens the browser's
 * own find over a page that is covered. So Tab wraps round, as it does in a
 * modal dialog.
 */
export function useFocusTrap(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = document.querySelector('.dh-overlay');
      if (root == null) return;
      const stops = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
      const first = stops[0];
      const last = stops.at(-1);
      if (first == null || last == null) return;
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === document.body)) {
        event.preventDefault();
        last.focus();
      }
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, []);
}
