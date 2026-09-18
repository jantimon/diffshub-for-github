import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  nextFile(): void;
  previousFile(): void;
  nextHunk(): void;
  previousHunk(): void;
  focusFilter(): void;
  toggleHelp(): void;
  close(): void;
}

// composedPath sees through a shadow root, which event.target does not.
function isTyping(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * GitHub's review keys, so there is nothing new to learn. Typing in a filter or
 * a comment box never triggers one, and neither does a chord — except Shift,
 * which `?` needs.
 *
 * The handlers live in a ref, so the listener binds once however often the
 * caller re-renders.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event)) return;

      const current = handlersRef.current;
      switch (event.key) {
        case 'j':
          current.nextFile();
          break;
        case 'k':
          current.previousFile();
          break;
        case 'n':
          current.nextHunk();
          break;
        case 'p':
          current.previousHunk();
          break;
        case '/':
          event.preventDefault();
          current.focusFilter();
          break;
        case '?':
          event.preventDefault();
          current.toggleHelp();
          break;
        case 'Escape':
          current.close();
          break;
      }
    };

    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, []);
}
