import { useState } from 'react';

import { MarkdownEditor } from '@/viewer/comments/MarkdownEditor';

/** The box for writing one comment, shown at the line it will be left on */
export function CommentComposer({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (): Promise<void> => {
    if (text.trim() === '' || sending) return;
    setSending(true);
    const posted = await onSubmit(text);
    setSending(false);
    if (posted) setText('');
  };

  return (
    <div className="dh-composer" data-tail="line">
      <MarkdownEditor
        value={text}
        onChange={setText}
        onSubmit={() => void send()}
        placeholder="Leave a comment"
        rows={3}
        disabled={sending}
        focusOnMount
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
