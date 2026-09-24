import { DEFAULT_THEMES } from '@pierre/diffs';
import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react';

export const POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 1) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory: () => {
    /**
     * The portable worker, not `worker.js`.
     *
     * `worker.js` is shipped unbundled: it imports `shiki/core`, `diff`,
     * `@pierre/theming` and four more by bare name. A module worker resolves no
     * bare specifier and there is no import map, so it fails on its first line
     * in every browser and every build.
     *
     * Silently, too: highlighting falls back to the main thread, which is the
     * one thread this viewer cannot afford to spend. `worker-portable.js` is
     * the same worker with its dependencies built in. `docs/upstream.md#worker-portable`
     */
    const worker = new URL('@pierre/diffs/worker/worker-portable.js', import.meta.url);
    if (worker.origin === location.origin) return new Worker(worker, { type: 'module' });

    /**
     * A worker script has to be same-origin. The build emits one beside the
     * extension and that is what the first branch takes.
     *
     * `pnpm dev` does not. It rewrites this url to the dev server on
     * `http://localhost`, while the viewer runs on `chrome-extension://`, and
     * loading a worker across those origins takes the whole frame down.
     *
     * There is no exception, no console entry and nothing in the terminal, just
     * Chrome's crashed-tab face inside the overlay and a white panel in
     * Firefox. Importing it from a blob, which is same-origin, keeps dev working
     */
    const shim = new Blob([`import ${JSON.stringify(worker.href)};`], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(shim), { type: 'module' });
  },
};

export const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  langs: ['tsx', 'typescript', 'css', 'go', 'python', 'rust', 'sh', 'cpp'],
};
