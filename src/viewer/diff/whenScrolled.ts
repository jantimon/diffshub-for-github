/** Longest a smooth scroll is waited for. A scroll with nowhere to go fires no `scrollend` */
const LONGEST_SCROLL_MS = 700;

/**
 * Runs once the pane has finished scrolling, so focus moved to something that
 * was scrolled to lands on it where it ends up, not where it was
 */
export function whenScrolled(pane: HTMLElement | undefined, run: () => void): void {
  if (pane == null) {
    run();
    return;
  }
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    pane.removeEventListener('scrollend', finish);
    run();
  };
  const timer = setTimeout(finish, LONGEST_SCROLL_MS);
  pane.addEventListener('scrollend', finish, { once: true });
}
