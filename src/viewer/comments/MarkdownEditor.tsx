import '@github/markdown-toolbar-element';
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { ask } from '@/viewer/ask';

/**
 * The box for writing a comment, with GitHub's own formatting toolbar.
 *
 * `@github/markdown-toolbar-element` is the element GitHub's comment box is
 * built from, published under MIT, so the buttons and their keyboard shortcuts
 * behave exactly as they do on GitHub. It works on an ordinary textarea, which
 * it finds by the id given in `for`.
 *
 * Its live editor cannot be reused directly: this runs as an extension page on
 * its own origin, where GitHub's scripts never run and its custom elements are
 * not defined. Installing the package is the closest thing to using their code,
 * and it is their code.
 *
 * The preview is GitHub's too -- see `previewMarkdown` for why it is not
 * rendered here.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 4,
  disabled = false,
  focusOnMount = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** Put the cursor in the box as soon as it appears, for a box the reader asked for */
  focusOnMount?: boolean;
}): JSX.Element {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [html, setHtml] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (focusOnMount) box.current?.focus();
  }, [focusOnMount]);

  const showPreview = async (): Promise<void> => {
    setPreviewing(true);
    setHtml(undefined);
    setError(undefined);
    if (value.trim() === '') return;
    const result = await ask('preview', { text: value });
    setHtml(result.html);
    setError(result.error);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit != null) {
      event.preventDefault();
      onSubmit();
    }
  };

  // GitHub renders and sanitises this, and the extension's content security
  // policy allows no inline script, so nothing in it can run
  const rendered = html == null ? undefined : <div dangerouslySetInnerHTML={{ __html: html }} />;

  return (
    <div className="dh-editor">
      <div className="dh-editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!previewing}
          data-dh-tab="write"
          onClick={() => setPreviewing(false)}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewing}
          data-dh-tab="preview"
          onClick={() => void showPreview()}
        >
          Preview
        </button>
      </div>

      {previewing ? (
        <div className="dh-markdown dh-editor-preview" data-dh-preview>
          {error != null && <p className="dh-editor-error">{error}</p>}
          {error == null && html == null && value.trim() !== '' && <p>Rendering…</p>}
          {value.trim() === '' && <p className="dh-editor-empty">Nothing to preview yet.</p>}
          {rendered}
        </div>
      ) : (
        <>
          <markdown-toolbar for={id} className="dh-editor-toolbar">
            <md-bold title="Bold (⌘B)">B</md-bold>
            <md-italic title="Italic (⌘I)">I</md-italic>
            <md-code title="Code">{'<>'}</md-code>
            <md-link title="Link (⌘K)">🔗</md-link>
            <md-quote title="Quote">❝</md-quote>
            <md-unordered-list title="Bulleted list">•</md-unordered-list>
            <md-ordered-list title="Numbered list">1.</md-ordered-list>
            <md-task-list title="Task list">☑</md-task-list>
            <md-mention title="Mention">@</md-mention>
          </markdown-toolbar>
          <textarea
            id={id}
            ref={box}
            className="dh-editor-text"
            rows={rows}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </>
      )}
    </div>
  );
}
