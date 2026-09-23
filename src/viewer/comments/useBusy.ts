import { useCallback, useState } from 'react';

/**
 * Runs one request at a time for a comment or a thread, with what it said when
 * it failed. `work` answers an error, or nothing when it went through, and
 * `after` runs only then.
 */
export function useBusy(): {
  busy: boolean;
  error: string | undefined;
  run: (work: () => Promise<string | undefined>, after?: () => void) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = useCallback(
    async (work: () => Promise<string | undefined>, after?: () => void): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(undefined);
      const failed = await work();
      setBusy(false);
      if (failed == null) after?.();
      else setError(failed);
    },
    [busy],
  );

  return { busy, error, run };
}
