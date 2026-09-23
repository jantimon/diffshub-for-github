import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type CodeViewItem,
} from '@pierre/diffs/react';
import { useFileTreeSearch } from '@pierre/trees/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReviewThread } from '@/shared/bridge';
import { filesUrl, GITHUB_ORIGIN, patchUrl, type PullRequestRef } from '@/shared/pullRequest';
import { ask } from '@/viewer/bridge/ask';
import { closeViewer, usePageInfo } from '@/viewer/bridge/usePageInfo';
import { CommentComposer } from '@/viewer/comments/CommentComposer';
import { Thread } from '@/viewer/comments/Thread';
import { useThreads } from '@/viewer/comments/useThreads';
import { BinaryCompare } from '@/viewer/diff/BinaryCompare';
import { createExpansionMemory } from '@/viewer/diff/expandedRegions';
import { FileLinks, ViewedButton } from '@/viewer/diff/FileHeader';
import { useDiffOptions } from '@/viewer/diff/useDiffOptions';
import { useNavigation } from '@/viewer/diff/useNavigation';
import { HIGHLIGHTER_OPTIONS, POOL_OPTIONS } from '@/viewer/diff/workerPool';
import { FindBar } from '@/viewer/find/FindBar';
import { useFind } from '@/viewer/find/useFind';
import { createFileLoader } from '@/viewer/net/fileLoader';
import { copyPath, type FileRefs } from '@/viewer/net/fileLinks';
import { ReviewDialog } from '@/viewer/review/ReviewDialog';
import { useMarkViewed } from '@/viewer/review/useMarkViewed';
import { storedViewed, useViewed } from '@/viewer/review/useViewed';
import { ShortcutHelp } from '@/viewer/shell/ShortcutHelp';
import { ToastStack, useToasts } from '@/viewer/shell/Toast';
import { Toolbar } from '@/viewer/shell/Toolbar';
import { useFocusTrap } from '@/viewer/shell/useFocusTrap';
import { useShortcuts } from '@/viewer/shell/useShortcuts';
import { useThemeSurfaces } from '@/viewer/shell/useThemeSurfaces';
import { useViewerChoices } from '@/viewer/shell/useViewerChoices';
import { createSession, useSession } from '@/viewer/state/session';
import { usePatchLoader } from '@/viewer/state/usePatchLoader';
import { Sidebar } from '@/viewer/tree/Sidebar';
import { useFilters } from '@/viewer/tree/useFilters';
import { useInViewMarks } from '@/viewer/tree/useInViewMarks';
import { useSidebarWidth } from '@/viewer/tree/useSidebarWidth';
import { useTreeModel } from '@/viewer/tree/useTreeModel';

export function Overlay({ pr, openedAtSha }: { pr: PullRequestRef; openedAtSha?: string }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <Viewer pr={pr} openedAtSha={openedAtSha} />
    </WorkerPoolContextProvider>
  );
}

/**
 * The viewer: the toolbar, the file tree, the diff and the dialogs, put
 * together. Each feature lives in a hook or a component of its own, and this
 * only connects them. What they share is the session (`state/session.ts`).
 */
function Viewer({ pr, openedAtSha }: { pr: PullRequestRef; openedAtSha?: string }) {
  const page = usePageInfo();
  const toasts = useToasts();
  const pushToast = toasts.push;
  const viewerRef = useRef<CodeViewHandle<ReviewThread, undefined> | null>(null);

  const choices = useViewerChoices(page.themeType);
  const sidebar = useSidebarWidth();
  const filters = useFilters();

  const key = `${pr.owner}/${pr.repo}/${pr.number}`;
  const [session] = useState(() => createSession(storedViewed(key, openedAtSha)));
  usePatchLoader({
    session,
    url: patchUrl(pr),
    sha: openedAtSha,
    /**
     * The commit belongs in the key: the viewer library caches its rendering
     * of each file under it, and the same position names different content
     * once the branch moves
     */
    cacheKeyPrefix: `${key}@${openedAtSha ?? 'unknown'}`,
    filter: filters.filter,
    ignoreWhitespace: choices.ignoreWhitespace,
  });
  const { toggle, markAll } = useViewed(session, key, openedAtSha, pushToast);

  const openFile = useCallback(
    (path: string) => {
      const id = session.get().pathToItemId.get(path);
      if (id != null) viewerRef.current?.scrollTo({ type: 'item', id, align: 'start', behavior: 'smooth' });
    },
    [session],
  );
  const model = useTreeModel({ session, onOpen: openFile, onToggle: toggle });
  const search = useFileTreeSearch(model);

  const navigation = useNavigation(viewerRef, session);
  const markInView = useInViewMarks({ viewerRef, session, model });
  const [expansion] = useState(createExpansionMemory);
  const find = useFind({ viewerRef, session, expansion, currentFile: navigation.currentIndex });
  const findInputRef = useRef<HTMLInputElement>(null);
  const markViewed = useMarkViewed({ session, viewerRef, toggle });

  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [comparing, setComparing] = useState<string | undefined>(undefined);

  /**
   * Cmd+F opens find, or selects what is in its box. Pressed again while the
   * box has the keyboard, it is left to the browser, so its own find is one
   * more press away. Text selected in the diff becomes the query.
   */
  const openFind = useCallback((): boolean => {
    const active = document.activeElement;
    if (find.open && active instanceof HTMLInputElement && active.closest('[data-dh-find]') != null)
      return false;
    const selected = document.getSelection()?.toString() ?? '';
    find.show(selected !== '' && !selected.includes('\n') && selected.length <= 200 ? selected : undefined);
    // The bar may only mount on this render, so the box is focused on the next frame
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return true;
  }, [find]);

  const closeFind = useCallback(() => {
    find.hide();
    viewerRef.current?.getInstance()?.getContainerElement()?.focus({ preventScroll: true });
  }, [find]);

  useFocusTrap();
  useShortcuts({
    ...navigation,
    toggleViewed: useCallback(() => {
      const file = session.get().visible[navigation.currentIndex()];
      if (file != null) markViewed(file.path);
    }, [markViewed, navigation, session]),
    focusFilter: useCallback(() => search.open(), [search]),
    toggleHelp: useCallback(() => setHelpOpen((open) => !open), []),
    openFind,
    findStep: useCallback(
      (delta: 1 | -1): boolean => {
        if (!find.open) return false;
        find.step(delta);
        return true;
      },
      [find],
    ),
    close: useCallback(() => (find.open ? closeFind() : closeViewer()), [find.open, closeFind]),
  });

  const visible = useSession(session, (state) => state.visible);
  const items = useMemo(() => visible.map((file) => file.item), [visible]);
  const comments = useThreads(items, pushToast);
  const { closeDraft, post, reply, resolve, edit, remove } = comments;

  /**
   * The wrapper is what the card measures itself against. The cell the viewer
   * slots this into is half a window wide in a split diff and a whole one in a
   * unified diff, and the card has to read well in both.
   */
  const renderAnnotation = useCallback(
    (annotation: { metadata?: ReviewThread }) => {
      const thread = annotation.metadata;
      if (thread == null) return null;
      return (
        <div className="dh-annotation">
          {thread.isDraft === true ? (
            <CommentComposer
              side={thread.side}
              onCancel={closeDraft}
              onSubmit={async (text) => {
                const failed = await post(thread, text);
                if (failed != null) pushToast(failed);
                return failed == null;
              }}
            />
          ) : (
            <Thread
              thread={thread}
              onReply={(body) => reply(thread, body)}
              onResolve={() => resolve(thread)}
              onEdit={edit}
              onDelete={remove}
            />
          )}
        </div>
      );
    },
    [closeDraft, edit, post, pushToast, remove, reply, resolve],
  );

  const phase = useSession(session, (state) => state.phase);
  const loadError = useSession(session, (state) => state.error);
  useEffect(() => {
    if (phase === 'error' && loadError != null) {
      pushToast(loadError, { label: 'Open on GitHub', href: filesUrl(pr) });
    }
  }, [phase, loadError, pushToast, pr]);

  // The two revisions a binary file is compared across. Without the base there
  // is nothing to compare against, so the viewer shows the new file alone
  // rather than the same image twice under two headings
  const baseSha = useSession(session, (state) => state.baseSha);
  const refs = useMemo<FileRefs | undefined>(
    () =>
      openedAtSha == null ? undefined : { owner: pr.owner, repo: pr.repo, baseSha, headSha: openedAtSha },
    [baseSha, openedAtSha, pr.owner, pr.repo],
  );
  const loadDiffFiles = useMemo(
    () => (openedAtSha == null ? undefined : createFileLoader(pr, openedAtSha)),
    [openedAtSha, pr],
  );

  const copyToClipboard = useCallback(
    (path: string) => {
      void (async () =>
        pushToast((await copyPath(path)) ? 'Path copied.' : 'The clipboard is blocked here.'))();
    },
    [pushToast],
  );
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<ReviewThread>) => (
      <ViewedButton session={session} item={item} onToggle={markViewed} />
    ),
    [markViewed, session],
  );
  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<ReviewThread>) => (
      <FileLinks item={item} refs={refs} onCompare={setComparing} onCopy={copyToClipboard} />
    ),
    [copyToClipboard, refs],
  );

  const options = useDiffOptions({
    diffStyle: choices.layout,
    themeType: choices.themeType,
    page,
    commenting: !comments.hidden,
    loadDiffFiles,
    onComment: comments.openDraft,
    /**
     * After each file is drawn: find learns which gaps were opened, its marks
     * get new rows to go on, and the files in view may have moved
     */
    afterRender: (instance) => {
      markInView();
      if (expansion.record(instance) && find.open) find.refresh();
      if (find.open) find.repaint();
    },
  });

  const themeName = choices.themeType === 'dark' ? page.darkTheme : page.lightTheme;
  const surfaces = useThemeSurfaces(themeName);
  const stats = useSession(session, (state) => state.stats);
  const viewedOnShow = useSession(
    session,
    (state) => state.visible.filter((file) => state.viewed.has(file.path)).length,
  );

  return (
    /* `colorScheme` is what makes `light-dark` in the viewer's own stylesheet
       pick the right value, and it gives the scrollbars and the form controls
       the same scheme as the diff */
    <div
      className="dh-overlay"
      data-theme={choices.themeType}
      data-layout={choices.layout}
      data-dh-phase={phase}
      style={{ colorScheme: choices.themeType, ...surfaces.overlay }}
    >
      <Toolbar
        pr={pr}
        page={page}
        stats={stats}
        viewedOnShow={viewedOnShow}
        loading={phase === 'loading'}
        sidebarOpen={choices.sidebarOpen}
        diffStyle={choices.layout}
        themeType={choices.themeType}
        ignoreWhitespace={choices.ignoreWhitespace}
        hideComments={comments.hidden}
        onToggleSidebar={choices.toggleSidebar}
        onToggleWhitespace={choices.toggleWhitespace}
        onToggleComments={comments.toggleHidden}
        onToggleLayout={choices.toggleLayout}
        onToggleTheme={choices.toggleTheme}
        onFinishReview={() => setReviewOpen(true)}
        onShowHelp={() => setHelpOpen(true)}
        onFind={openFind}
        onClose={closeViewer}
      />

      <div className="dh-body">
        <Sidebar
          open={choices.sidebarOpen}
          width={sidebar.width}
          model={model}
          // The tree's own stylesheet follows the system until the theme resolves
          treeSurface={{ colorScheme: choices.themeType, ...surfaces.tree }}
          session={session}
          filters={filters.fields}
        />
        {choices.sidebarOpen && (
          <div
            className="dh-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the file tree"
            onPointerDown={sidebar.startResize}
          />
        )}
        <CodeView<ReviewThread, undefined>
          ref={viewerRef}
          className="dh-code"
          items={comments.items}
          options={options}
          renderAnnotation={renderAnnotation}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderMetadata={renderHeaderMetadata}
        />
        {find.open && (
          <FindBar
            find={find}
            inputRef={findInputRef}
            onClose={closeFind}
            onShowHidden={() => {
              filters.clear();
              if (choices.ignoreWhitespace) choices.showSpacingOnly();
            }}
          />
        )}
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {reviewOpen && (
        <ReviewDialog
          repo={`${pr.owner}/${pr.repo}`}
          number={pr.number}
          title={page.title}
          url={`${GITHUB_ORIGIN}/${pr.owner}/${pr.repo}/pull/${pr.number}`}
          viewed={viewedOnShow}
          total={stats.fileCount}
          onViewRemaining={() => {
            const { visible: files, viewed } = session.get();
            const next = files.find((file) => !viewed.has(file.path));
            if (next != null) openFile(next.path);
          }}
          onClose={() => setReviewOpen(false)}
          onSubmit={async (verdict, body, markRemaining) => {
            const result = await ask('review', { event: verdict, body });
            if (!result.ok) return result.error ?? 'GitHub refused the review.';
            pushToast('Review submitted.');
            void comments.reload();
            // After the verdict, so a refused tick never holds up the review
            if (markRemaining) {
              void (async () => {
                const refused = await markAll(session.get().visible.map((file) => file.path));
                if (refused.length === 0) return;
                pushToast(`GitHub did not record ${refused.length} file(s) as viewed: ${refused.join(', ')}`);
              })();
            }
            return undefined;
          }}
        />
      )}
      {comparing != null && refs != null && (
        <BinaryCompare refs={refs} path={comparing} onClose={() => setComparing(undefined)} />
      )}
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
