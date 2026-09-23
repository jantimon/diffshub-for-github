import type { CodeViewItem } from '@pierre/diffs/react';
import { IconEye, IconEyeSlash } from '@pierre/icons';
import type { JSX } from 'react';

import type { ReviewThread } from '@/shared/bridge';
import { isImagePath } from '@/viewer/diff/BinaryCompare';
import { blameUrl, blobUrl, type FileRefs } from '@/viewer/net/fileLinks';
import { useSession, type Session } from '@/viewer/state/session';

/** The file a diff item shows, as the patch names it */
export function itemPath(item: CodeViewItem<ReviewThread>): string {
  return item.type === 'diff' ? item.fileDiff.name : item.id;
}

/**
 * The eye at the start of a file's header. Open means still to read, closed
 * means done. A button rather than a tick box, so Space works on it the same
 * way and reviewing a pull request is Space, read, Space.
 */
export function ViewedButton({
  session,
  item,
  onToggle,
}: {
  session: Session;
  item: CodeViewItem<ReviewThread>;
  onToggle: (path: string) => void;
}): JSX.Element {
  const path = itemPath(item);
  const isViewed = useSession(session, (state) => state.viewed.has(path));
  return (
    <button
      type="button"
      className="dh-viewed"
      data-dh-viewed={item.id}
      aria-pressed={isViewed}
      title={isViewed ? 'Mark as not viewed' : 'Mark as viewed'}
      onClick={() => onToggle(path)}
    >
      {isViewed ? <IconEyeSlash size={14} /> : <IconEye size={14} />}
    </button>
  );
}

/**
 * The links at the end of a file's header: a moved file's badge, comparing a
 * changed image, copying the path, and the file and its blame on GitHub.
 * Without the revisions (`refs`) there is nothing to link to.
 */
export function FileLinks({
  item,
  refs,
  onCompare,
  onCopy,
}: {
  item: CodeViewItem<ReviewThread>;
  refs: FileRefs | undefined;
  onCompare: (path: string) => void;
  onCopy: (path: string) => void;
}): JSX.Element | null {
  if (item.type !== 'diff') return null;
  const path = item.fileDiff.name;
  const moved = item.fileDiff.type === 'rename-pure' || item.fileDiff.type === 'rename-changed';
  const isBinary = item.fileDiff.hunks.length === 0;
  return (
    <span className="dh-file-links">
      {moved && <span className="dh-moved">MOVED</span>}
      {refs != null && isBinary && isImagePath(path) && (
        <button type="button" onClick={() => onCompare(path)}>
          Compare
        </button>
      )}
      <button type="button" onClick={() => onCopy(path)}>
        Copy path
      </button>
      {refs != null && (
        <>
          <a href={blobUrl(refs, path, 'head')} target="_top">
            File
          </a>
          <a href={blameUrl(refs, path)} target="_top">
            Blame
          </a>
        </>
      )}
    </span>
  );
}
