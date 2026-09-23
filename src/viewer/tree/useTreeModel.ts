import type { FileTree } from '@pierre/trees';
import { useFileTree } from '@pierre/trees/react';
import { useEffect, useRef } from 'react';

import type { ParsedFile } from '@/patch/accumulator';
import type { Session, SessionState } from '@/viewer/state/session';
import { TREE_CSS } from '@/viewer/tree/treeStyles';

type Tally = ReadonlyMap<string, { total: number; viewed: number }>;

/** Per folder, how many files it holds and how many of them are ticked off */
function tallyFolders(visible: readonly ParsedFile[], viewed: ReadonlySet<string>): Tally {
  const tally = new Map<string, { total: number; viewed: number }>();
  for (const { path } of visible) {
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      const entry = tally.get(folder) ?? { total: 0, viewed: 0 };
      entry.total += 1;
      if (viewed.has(path)) entry.viewed += 1;
      tally.set(folder, entry);
    }
  }
  return tally;
}

/**
 * The file tree beside the diff: its rows follow the files on show, each row
 * carries the file's tick or its find count, and a folder is ticked once all
 * of it is read.
 *
 * The tree draws its rows outside React and asks for each row's decoration as
 * it draws it, so the decoration reads the session directly. `onOpen` runs when
 * a file is chosen in the tree, `onToggle` when Space is pressed on one.
 */
export function useTreeModel({
  session,
  onOpen,
  onToggle,
}: {
  session: Session;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
}): FileTree {
  // The tree keeps the callbacks it was built with, so these carry the current ones
  const onOpenRef = useRef(onOpen);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onOpenRef.current = onOpen;
    onToggleRef.current = onToggle;
  });

  // The folder tally is worked out once per change of files or ticks, not per row
  const tallyRef = useRef<{ visible?: readonly ParsedFile[]; viewed?: ReadonlySet<string>; tally: Tally }>({
    tally: new Map(),
  });
  const folders = ({ visible, viewed }: SessionState): Tally => {
    const cached = tallyRef.current;
    if (cached.visible !== visible || cached.viewed !== viewed) {
      tallyRef.current = { visible, viewed, tally: tallyFolders(visible, viewed) };
    }
    return tallyRef.current.tally;
  };

  const { model } = useFileTree({
    id: 'diffshub-tree',
    paths: [],
    gitStatus: [],
    presorted: true,
    sort: () => 0,
    search: true,
    stickyFolders: true,
    flattenEmptyDirectories: true,
    initialExpansion: 'open',
    itemHeight: 24,
    unsafeCSS: TREE_CSS,
    onSelectionChange(selected) {
      if (selected.length === 1 && selected[0] != null) onOpenRef.current(selected[0]);
    },
    renderRowDecoration({ item }) {
      const state = session.get();
      if (item.kind === 'file') {
        const id = state.pathToItemId.get(item.path);
        const matches = id == null ? undefined : state.found.get(id);
        if (matches != null) return { text: String(matches), title: `${matches} matches` };
        return state.viewed.has(item.path) ? { text: '✓', title: 'Viewed' } : null;
      }
      // The tree names a folder with a trailing slash. The tally is keyed by
      // the path as it appears in the patch, which has none
      const folder = folders(state).get(item.path.replace(/\/$/, ''));
      if (folder == null || folder.total === 0 || folder.viewed < folder.total) return null;
      return { text: '✓', title: `All ${folder.total} files viewed` };
    },
  });

  // The rows follow the files on show: added as the patch streams in, rebuilt
  // when a filter changes which files those are
  useEffect(() => {
    let shown: readonly ParsedFile[] = [];
    const sync = (): void => {
      const { visible } = session.get();
      if (visible === shown) return;
      const grew = visible.length >= shown.length && shown.every((file, at) => visible[at] === file);
      if (grew) {
        const added = visible.slice(shown.length);
        if (added.length > 0) {
          model.batch(added.map((file) => ({ type: 'add' as const, path: file.path })));
          const statuses = added.flatMap((file) =>
            file.status == null ? [] : [{ path: file.path, status: file.status }],
          );
          if (statuses.length > 0) model.applyGitStatusPatch({ set: statuses });
        }
      } else {
        model.resetPaths(visible.map((file) => file.path));
        model.setGitStatus(
          visible.flatMap((file) => (file.status == null ? [] : [{ path: file.path, status: file.status }])),
        );
      }
      shown = visible;
    };
    sync();
    return session.subscribe(sync);
  }, [model, session]);

  /**
   * Decorations are worked out as rows draw, so a change of ticks or matches
   * redraws the rows rather than waiting for the next scroll.
   *
   * Only once the tree is on the page. Asked to render with no container, the
   * tree makes one of its own, off the page, draws into that, and keeps the
   * drawing when the real one arrives, which leaves the sidebar empty.
   */
  useEffect(() => {
    let drawn = { viewed: session.get().viewed, found: session.get().found };
    return session.subscribe(() => {
      const { viewed, found } = session.get();
      if (viewed === drawn.viewed && found === drawn.found) return;
      drawn = { viewed, found };
      if (model.getFileTreeContainer() != null) model.render({});
    });
  }, [model, session]);

  /**
   * Space on a file in the tree marks it viewed, or not, and leaves the
   * keyboard on it, so a second Space takes the mark back off.
   *
   * The rows are buttons, so without this Space would press one, which opens
   * the file in the diff. Enter and a click still do that, and Space on a
   * folder still opens or closes it. Listened for on the window, ahead of
   * everything else, so it does not depend on when the tree mounts.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const path = event.composedPath();
      if (!path.some((node) => node instanceof HTMLElement && node.classList.contains('dh-tree'))) return;
      const row = path.find(
        (node): node is HTMLElement => node instanceof HTMLElement && node.dataset.type === 'item',
      );
      if (row?.dataset.itemType !== 'file' || row.dataset.fileTreeStickyRow != null) return;
      const file = row.dataset.itemPath;
      if (file == null || !session.get().pathToItemId.has(file)) return;
      event.preventDefault();
      event.stopPropagation();
      onToggleRef.current(file);
    };
    addEventListener('keydown', onKeyDown, true);
    return () => removeEventListener('keydown', onKeyDown, true);
  }, [session]);

  return model;
}
