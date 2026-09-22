import { IconCheck, IconComment, IconConflict, IconCopy, IconFile, IconX } from '@pierre/icons';
import { useEffect, useRef, useState, type ComponentType, type JSX } from 'react';

import type { ReviewEvent } from '@/bridge';
import { MarkdownEditor } from '@/viewer/comments/MarkdownEditor';

const VERDICTS: {
  value: ReviewEvent;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number }>;
}[] = [
  {
    value: 'comment',
    label: 'Comment',
    hint: 'Share feedback without approving or requesting changes.',
    icon: IconComment,
  },
  { value: 'approve', label: 'Approve', hint: 'The changes look good.', icon: IconCheck },
  {
    value: 'request changes',
    label: 'Request changes',
    hint: 'These changes need revisions before they can be merged.',
    icon: IconConflict,
  },
];

/** Says where the reading stands, without inventing praise for it */
function progressNote(remaining: number, total: number): string {
  if (total === 0) return 'Nothing to read.';
  if (remaining === 0) return 'Every file read.';
  if (remaining === 1) return 'One file still to read.';
  return `${remaining} files still to read.`;
}

/** GitHub turns away a "request changes" with nothing written in it */
const NEEDS_A_NOTE: ReviewEvent = 'request changes';

/**
 * Not GitHub's batched review: a line comment written here is posted the moment
 * it is written, so there is nothing held back
 */
const POSTED_NOTE = 'Comments you left on lines are already posted. This adds the verdict.';

export function ReviewDialog({
  repo,
  number,
  title,
  url,
  viewed,
  total,
  onViewRemaining,
  onSubmit,
  onClose,
}: {
  repo: string;
  number: number;
  title: string;
  url: string;
  viewed: number;
  total: number;
  onViewRemaining: () => void;
  onSubmit: (event: ReviewEvent, body: string) => Promise<string | undefined>;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<ReviewEvent>('comment');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog == null) return;
    dialog.showModal();

    // A click on the backdrop lands on the dialog itself. Esc is the keyboard
    // way out and the browser handles that one
    const onBackdropClick = (click: Event): void => {
      if (click.target === dialog) dialog.close();
    };
    dialog.addEventListener('click', onBackdropClick);
    return () => dialog.removeEventListener('click', onBackdropClick);
  }, []);

  const remaining = Math.max(total - viewed, 0);
  const read = total === 0 ? 0 : Math.round((viewed / total) * 100);
  const missingNote = event === NEEDS_A_NOTE && body.trim() === '';

  const send = async (): Promise<void> => {
    if (sending || missingNote) return;
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
      onKeyDown={(key) => {
        if (key.key === 'Enter' && (key.metaKey || key.ctrlKey)) {
          key.preventDefault();
          void send();
        }
      }}
    >
      <div className="dh-review-panel">
        <header className="dh-review-head">
          <img
            className="dh-review-mascot"
            // The viewer is served from the extension root, so this resolves
            // without needing the extension id
            src="./review-celebrate.png"
            alt=""
            width={72}
            height={72}
          />
          <div className="dh-review-heading">
            <h2>Finish your review</h2>
            <p className="dh-review-which">
              <strong>{repo}</strong>
              <span className="dh-review-number">#{number}</span>
              <button
                type="button"
                className="dh-review-copy"
                title={copied ? 'Copied' : 'Copy the link to this pull request'}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
            </p>
            {title !== '' && <p className="dh-review-title">{title}</p>}
          </div>
          <button
            type="button"
            className="dh-review-close"
            title="Close"
            onClick={() => dialogRef.current?.close()}
          >
            <IconX size={16} />
          </button>
        </header>

        <section className="dh-review-progress">
          <IconFile size={20} />
          <div className="dh-review-progress-body">
            <p>
              Files viewed <span className="dh-review-progress-note">{progressNote(remaining, total)}</span>
            </p>
            <div className="dh-review-bar" aria-hidden="true">
              <span style={{ width: `${read}%` }} />
            </div>
          </div>
          <p className="dh-review-count">
            {viewed} / {total}
          </p>
          {remaining > 0 && (
            <button
              type="button"
              className="dh-review-remaining"
              onClick={() => {
                onViewRemaining();
                dialogRef.current?.close();
              }}
            >
              View remaining {remaining}
            </button>
          )}
        </section>

        <section>
          <h3>Review outcome</h3>
          <div className="dh-review-verdicts">
            {VERDICTS.map((verdict) => (
              <label
                key={verdict.value}
                className="dh-review-verdict"
                data-chosen={event === verdict.value}
                data-verdict={verdict.value}
              >
                <input
                  type="radio"
                  name="dh-verdict"
                  value={verdict.value}
                  checked={event === verdict.value}
                  disabled={sending}
                  onChange={() => setEvent(verdict.value)}
                />
                <span className="dh-review-verdict-mark" aria-hidden="true">
                  <verdict.icon size={16} />
                </span>
                {event === verdict.value && (
                  <span className="dh-review-verdict-chosen" aria-hidden="true">
                    <IconCheck size={12} />
                  </span>
                )}
                <span className="dh-review-verdict-label">{verdict.label}</span>
                <span className="dh-review-verdict-hint">{verdict.hint}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <div className="dh-review-summary-head">
            <h3>Review summary</h3>
            <span className="dh-review-markdown">Markdown supported</span>
          </div>
          <MarkdownEditor
            value={body}
            onChange={setBody}
            onSubmit={() => void send()}
            placeholder="Summarise your review — key findings, overall feedback, or next steps…"
            rows={6}
            disabled={sending}
          />
          {missingNote && <p className="dh-review-required">Required for this review type</p>}
        </section>

        {error != null && <p className="dh-review-error">{error}</p>}

        <footer className="dh-review-foot">
          <p className="dh-review-note">{POSTED_NOTE}</p>
          <div className="dh-review-actions">
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="dh-review-send"
              onClick={() => void send()}
              disabled={sending || missingNote}
              title="Submit review (⌘↩)"
            >
              {sending ? 'Submitting…' : 'Submit review'}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
