import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';

import { blobUrl, rawUrl, type FileRefs } from '@/viewer/files/fileLinks';
import { githubFetch } from '@/viewer/files/githubFetch';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp']);

export function isImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

type SideStatus = 'loading' | 'present' | 'missing' | 'error';

interface SideState {
  status: SideStatus;
  size?: number;
}

interface Dimensions {
  width: number;
  height: number;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** A 404 is how a side that does not exist — added or deleted — announces itself. */
async function readSide(url: string, signal: AbortSignal): Promise<SideState> {
  const response = await githubFetch(url, signal);
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return { status: 'missing' };
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return { status: 'error' };
  }
  const header = response.headers.get('Content-Length');
  if (header != null && header !== '') {
    void response.body?.cancel().catch(() => {});
    return { status: 'present', size: Number(header) };
  }
  const blob = await response.blob();
  return { status: 'present', size: blob.size };
}

export function BinaryCompare({
  refs,
  path,
  onClose,
}: {
  refs: FileRefs;
  path: string;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  const onBackdropClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }, []);

  const preview = isImagePath(path);

  return (
    <dialog className="dh-binary" ref={dialogRef} onClose={onClose} onClick={onBackdropClick}>
      <header className="dh-binary-header">
        <strong className="dh-binary-path">{path}</strong>
        <button type="button" className="dh-binary-close" onClick={close} title="Close (Esc)">
          ✕
        </button>
      </header>
      {/* Without a base revision there is nothing to compare against. Showing
          the new file twice, once labelled "Before", would say the file had not
          changed when it had. */}
      <div className="dh-binary-sides">
        {refs.baseSha != null && <BinarySide refs={refs} path={path} side="base" preview={preview} />}
        <BinarySide refs={refs} path={path} side="head" preview={preview} />
      </div>
      {refs.baseSha == null && (
        <p className="dh-binary-note">GitHub has not said which commit this diff starts at, so only the new file is shown.</p>
      )}
    </dialog>
  );
}

const SIDE_LABEL = { base: 'Before', head: 'After' } as const;

function BinarySide({
  refs,
  path,
  side,
  preview,
}: {
  refs: FileRefs;
  path: string;
  side: 'base' | 'head';
  preview: boolean;
}) {
  const url = rawUrl(refs, path, side);
  const [state, setState] = useState<SideState>({ status: 'loading' });
  const [dimensions, setDimensions] = useState<Dimensions>();

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    readSide(url, controller.signal).then(
      (next) => {
        if (live) setState(next);
      },
      () => {
        if (live) setState({ status: 'error' });
      }
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [url]);

  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
  }, []);

  const sha = shortSha((side === 'base' ? refs.baseSha : refs.headSha) ?? refs.headSha);

  return (
    <section className="dh-binary-side">
      <h3 className="dh-binary-label">
        {SIDE_LABEL[side]} <span className="dh-binary-sha">{sha}</span>
      </h3>

      {state.status === 'missing' && <p className="dh-binary-absent">Not in this revision</p>}

      {state.status === 'error' && (
        <p className="dh-binary-absent">
          Couldn&rsquo;t read this file.{' '}
          <a href={blobUrl(refs, path, side)} target="_top">
            Open on GitHub
          </a>
        </p>
      )}

      {state.status === 'loading' && <p className="dh-binary-absent">Loading…</p>}

      {state.status === 'present' && preview && (
        <img className="dh-binary-image" src={url} alt={`${path} at ${sha}`} onLoad={onLoad} />
      )}

      {state.status === 'present' && !preview && (
        <a className="dh-binary-link" href={url} target="_top">
          {sha}
        </a>
      )}

      {state.status === 'present' && (
        <p className="dh-binary-meta">
          {dimensions != null && preview && (
            <span>
              {dimensions.width} × {dimensions.height}
            </span>
          )}
          {state.size != null && <span>{formatBytes(state.size)}</span>}
        </p>
      )}
    </section>
  );
}
