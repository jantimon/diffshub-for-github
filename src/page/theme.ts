export interface GitHubTheme {
  themeType: 'light' | 'dark';
  theme: { light: string; dark: string };
}

/**
 * GitHub's theme names, mapped to the theme the viewer renders in.
 *
 * Plain light is VS Code's own default rather than a Pierre theme, because
 * `pierre-light` colours 133 of its 247 tokens below the 4.5:1 contrast the
 * WCAG asks for, operators worst of all at 2.14:1. `light-plus` has one, and
 * gets there largely by leaving operators the foreground colour instead of
 * tinting them.
 *
 * The variants built for high contrast and for colour vision deficiency stay
 * on Pierre: they are made for that, and swapping them for a general-purpose
 * theme would lose what they are for.
 */
const THEME_BY_GITHUB: Record<string, string> = {
  light: 'light-plus',
  light_high_contrast: 'pierre-light-vibrant',
  light_colorblind: 'pierre-light-protanopia-deuteranopia',
  light_tritanopia: 'pierre-light-tritanopia',
  dark: 'pierre-dark',
  dark_dimmed: 'pierre-dark-soft',
  dark_high_contrast: 'pierre-dark-vibrant',
  dark_colorblind: 'pierre-dark-protanopia-deuteranopia',
  dark_tritanopia: 'pierre-dark-tritanopia',
};

/** Reads GitHub's active theme off `<html>` once, when the overlay opens */
export function readGitHubTheme(): GitHubTheme {
  const root = document.documentElement;
  const mode = root.dataset.colorMode ?? 'auto';
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark);

  const lightName = root.dataset.lightTheme ?? 'light';
  const darkName = root.dataset.darkTheme ?? 'dark';

  return {
    themeType: isDark ? 'dark' : 'light',
    theme: {
      light: THEME_BY_GITHUB[lightName] ?? 'light-plus',
      dark: THEME_BY_GITHUB[darkName] ?? 'pierre-dark',
    },
  };
}
