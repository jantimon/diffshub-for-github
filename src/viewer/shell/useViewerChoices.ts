import { useChoice } from '@/viewer/settings';

/**
 * The view switches in the toolbar, each remembered for the next pull request:
 * split or unified, the file tree shown or not, files that changed only in
 * spacing shown or hidden, and a theme that wins over GitHub's
 */
export function useViewerChoices(pageTheme: 'light' | 'dark') {
  const [layout = 'split', setLayout] = useChoice('layout', ['split', 'unified'] as const, 'split');
  const [sidebar = 'open', setSidebar] = useChoice('sidebar', ['open', 'closed'] as const, 'open');
  const [whitespace = 'show', setWhitespace] = useChoice('whitespace', ['show', 'ignore'] as const, 'show');
  // Reading code in light while GitHub sits in dark is a fair preference, so
  // once this is set it wins over the page. Light or dark, nothing automatic:
  // no stored choice means the page decides
  const [themeChoice, setThemeChoice] = useChoice('theme', ['light', 'dark'] as const, undefined);
  const themeType = themeChoice ?? pageTheme;

  return {
    layout,
    sidebarOpen: sidebar === 'open',
    ignoreWhitespace: whitespace === 'ignore',
    themeType,
    toggleLayout: () => setLayout(layout === 'split' ? 'unified' : 'split'),
    toggleSidebar: () => setSidebar(sidebar === 'open' ? 'closed' : 'open'),
    toggleWhitespace: () => setWhitespace(whitespace === 'ignore' ? 'show' : 'ignore'),
    showSpacingOnly: () => setWhitespace('show'),
    toggleTheme: () => setThemeChoice(themeType === 'dark' ? 'light' : 'dark'),
  };
}
