import { useEffect, useRef, useState, type JSX } from 'react';

import type { ReviewEvent } from '@/bridge';

const VERDICTS: { value: ReviewEvent; label: string; hint: string }[] = [
  { value: 'comment', label: 'Comment', hint: 'Leave a note without approving or asking for changes.' },
  { value: 'approve', label: 'Approve', hint: 'Sign this off.' },
  { value: 'request changes', label: 'Request changes', hint: 'Ask for work before it can go in.' },
];

/** The verdict and covering note that finish a review. */
export function ReviewDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (event: ReviewEvent, body: string) => Promise<string | undefined>;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<ReviewEvent>('comment');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const send = async (): Promise<void> => {
    if (sending) return;
    setSending(true);
    setError(undefined);
    const failed = await onSubmit(event, body);
    setSending(false);
    if (failed == null) dialogRef.current?.close();
    else setError(failed);
  };

  return (
    <dialog
      ref={dialogRef}
      className="dh-review"
      onClose={onClose}
      onClick={(click) => {
        if (click.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="dh-review-panel">
        <h2>Finish your review</h2>
        <textarea
          className="dh-review-text"
          rows={5}
          value={body}
          placeholder="Leave a comment"
          disabled={sending}
          onChange={(change) => setBody(change.target.value)}
        />
        <div className="dh-review-verdicts">
          {VERDICTS.map((verdict) => (
            <label key={verdict.value} title={verdict.hint}>
              <input
                type="radio"
                name="dh-verdict"
                value={verdict.value}
                checked={event === verdict.value}
                disabled={sending}
                onChange={() => setEvent(verdict.value)}
              />
              {verdict.label}
            </label>
          ))}
        </div>
        {error != null && <p className="dh-review-error">{error}</p>}
        <div className="dh-review-actions">
          <button type="button" onClick={() => dialogRef.current?.close()} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="dh-review-send" onClick={() => void send()} disabled={sending}>
            {sending ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
