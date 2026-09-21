import type { HTMLAttributes } from 'react';

/**
 * The custom elements `@github/markdown-toolbar-element` defines.
 *
 * They are ordinary HTML elements at runtime; this only tells TypeScript that
 * they exist so they can be written in JSX.
 */
type ToolbarButton = HTMLAttributes<HTMLElement>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'markdown-toolbar': HTMLAttributes<HTMLElement> & { for: string };
      'md-bold': ToolbarButton;
      'md-italic': ToolbarButton;
      'md-code': ToolbarButton;
      'md-link': ToolbarButton;
      'md-quote': ToolbarButton;
      'md-unordered-list': ToolbarButton;
      'md-ordered-list': ToolbarButton;
      'md-task-list': ToolbarButton;
      'md-mention': ToolbarButton;
      'md-header': ToolbarButton;
      'md-strikethrough': ToolbarButton;
      'md-ref': ToolbarButton;
    }
  }
}
