import { resolveTheme, type DiffsThemeNames } from '@pierre/diffs';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import { useEffect, useState, type CSSProperties } from 'react';

export interface ThemeSurfaces {
  /** Custom properties for the overlay's own chrome */
  overlay: CSSProperties;
  /** Custom properties the file tree reads for its shadow DOM */
  tree: TreeThemeStyles;
}

const EMPTY: ThemeSurfaces = { overlay: {}, tree: {} };

/**
 * Paints the overlay in the same colours as the diff.
 *
 * The file tree and the diff each render into their own shadow DOM and take
 * their colours from the resolved theme, so the header, the sidebar and the
 * toolbar read it too rather than carrying a second palette that drifts.
 */
export function useThemeSurfaces(themeName: string): ThemeSurfaces {
  const [surfaces, setSurfaces] = useState<ThemeSurfaces>(EMPTY);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const theme = await resolveTheme(themeName as DiffsThemeNames);
        if (!live) return;
        const colors: Record<string, string | undefined> = theme.colors ?? {};
        const background = colors['editor.background'] ?? theme.bg;
        const foreground = colors['editor.foreground'] ?? theme.fg;
        setSurfaces({
          tree: themeToTreeStyles(theme),
          overlay: {
            '--dh-bg': background,
            '--dh-fg': foreground,
            '--dh-chrome':
              colors['editorGroupHeader.tabsBackground'] ?? colors['sideBar.background'] ?? background,
            '--dh-sidebar': colors['sideBar.background'] ?? background,
            '--dh-border':
              colors['panel.border'] ??
              colors['sideBar.border'] ??
              colors['editorGroup.border'] ??
              'transparent',
            '--dh-added': colors['gitDecoration.addedResourceForeground'] ?? '#3fb950',
            '--dh-deleted': colors['gitDecoration.deletedResourceForeground'] ?? '#f85149',
            '--dh-accent': colors['textLink.foreground'] ?? colors['focusBorder'] ?? '#0969da',
          } as CSSProperties,
        });
      } catch {
        if (live) setSurfaces(EMPTY);
      }
    })();
    return () => {
      live = false;
    };
  }, [themeName]);

  return surfaces;
}
