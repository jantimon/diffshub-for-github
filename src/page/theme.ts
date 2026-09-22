export interface GitHubTheme {
  themeType: 'light' | 'dark';
  theme: { light: string; dark: string };
}

const PIERRE_THEME_BY_GITHUB: Record<string, string> = {
  light: 'pierre-light',
  light_high_contrast: 'pierre-light-vibrant',
  light_colorblind: 'pierre-light-protanopia-deuteranopia',
  light_tritanopia: 'pierre-light-tritanopia',
  dark: 'pierre-dark',
  dark_dimmed: 'pierre-dark-soft',
  dark_high_contrast: 'pierre-dark-vibrant',
  dark_colorblind: 'pierre-dark-protanopia-deuteranopia',
  dark_tritanopia: 'pierre-dark-tritanopia',
};

/**
 * Reads GitHub's active theme off `<html>` once, when the overlay opens, and
 * maps it to the closest Pierre pair
 */
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
      light: PIERRE_THEME_BY_GITHUB[lightName] ?? 'pierre-light',
      dark: PIERRE_THEME_BY_GITHUB[darkName] ?? 'pierre-dark',
    },
  };
}
