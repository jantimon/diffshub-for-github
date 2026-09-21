import { useEffect, useRef, useState } from 'react';

/** The box for writing one comment, shown at the line it will be left on. */
export function CommentComposer({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const send = async (): Promise<void> => {
    if (text.trim() === '' || sending) return;
    setSending(true);
    const posted = await onSubmit(text);
    setSending(false);
    if (posted) setText('');
  };

  return (
    <div className="dh-composer">
      <textarea
        ref={box}
        className="dh-composer-text"
        value={text}
        rows={3}
        placeholder="Leave a comment"
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          // The same key GitHub submits with.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="dh-composer-actions">
        <button type="button" onClick={onCancel} disabled={sending}>
          Cancel
        </button>
        <button
          type="button"
          className="dh-composer-send"
          onClick={() => void send()}
          disabled={sending || text.trim() === ''}
        >
          {sending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
