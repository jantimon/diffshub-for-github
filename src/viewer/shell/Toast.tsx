import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

const DISMISS_AFTER_MS = 8000;

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; href: string };
}

export interface ToastControls {
  toasts: Toast[];
  push: (message: string, action?: Toast['action']) => void;
  dismiss: (id: number) => void;
}

/**
 * Holds the toasts a feature raises when it degrades. A plain toast clears
 * itself. One carrying an action stays until the user has dealt with it, so
 * the link out to GitHub never disappears mid-read.
 */
export function useToasts(): ToastControls {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer != null) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, action?: Toast['action']) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, action }]);
      if (action == null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
        );
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}): JSX.Element {
  return (
    <output className="dh-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="dh-toast">
          <span className="dh-toast-message">{toast.message}</span>
          {toast.action != null && (
            <a className="dh-toast-action" href={toast.action.href} target="_top">
              {toast.action.label}
            </a>
          )}
          <button
            type="button"
            className="dh-toast-close"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </output>
  );
}
