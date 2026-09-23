import { readSetting } from '@/viewer/settings';

let talking: boolean | undefined;

/**
 * Writes to the viewer's console, for what is otherwise invisible: where the
 * patch came from, what the tree's in-view bar decided. Nothing else in the
 * extension writes to a reader's console, so it is on during development and
 * off in a built one until it is asked for:
 *
 *     localStorage.setItem('diffshub-for-github.debug', 'on')
 *
 * in the viewer's own console, which a built extension has no other way to
 * reach. It takes effect on the next reload of the viewer.
 */
export function debugLog(message: string, ...details: unknown[]): void {
  talking ??= import.meta.env.DEV || readSetting('debug', 'off') === 'on';
  if (!talking) return;
  console.info(`DiffsHub: ${message}`, ...details);
}
