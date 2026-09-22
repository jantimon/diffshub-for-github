import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  /**
   * A port of its own, bound to IPv4
   *
   * In development the content scripts are registered over the dev socket
   * rather than declared in the manifest, so if that socket never opens the
   * extension injects nothing: no marker on the tab, no overlay, and the
   * toolbar button has nobody to send its message to. It looks dead rather
   * than broken
   *
   * Two things close that socket. On the default 3000 the extension reaches
   * whatever else answers there, and two dev servers cannot share one port.
   * Left to itself the server binds `::1` alone, while Firefox asks for
   * `ws://localhost:3197` and resolves that to 127.0.0.1: the IPv6 address
   * answers and the IPv4 one refuses the connection
   */
  dev: {
    server: { port: 3197, host: '127.0.0.1' },
  },
  /**
   * Keep the dependency scan out of the read-only submodule, whose own
   * workspace packages are not installed here
   */
  vite: () => ({ optimizeDeps: { entries: ['src/**/*.{ts,tsx,html}'] } }),
  srcDir: 'src',
  manifestVersion: 3,
  /**
   * The submodule is a read-only reference and the screenshots are rebuilt on
   * every test run. Neither belongs in the source archive AMO asks for
   */
  zip: {
    excludeSources: ['research/**', 'test/screenshots/**', 'test/.profile/**', '.firefox-profile/**'],
  },
  manifest: {
    name: 'DiffsHub for GitHub',
    description:
      'Opens GitHub pull request diffs in a fast, virtualized viewer. Every request goes to github.com from your own browser.',
    /**
     * The viewer is an extension page, so these permissions let it fetch the
     * patch on the user's own session cookie. Nothing else is contacted
     */
    host_permissions: ['https://github.com/*', 'https://*.githubusercontent.com/*'],
    action: { default_title: 'Open this pull request in DiffsHub' },
    browser_specific_settings: {
      gecko: {
        id: 'diffshub-for-github@jantimon.dev',
        strict_min_version: '128.0',
        /**
         * Required of every new Firefox extension. Nothing is collected: the
         * diff is fetched from github.com and rendered, and nothing leaves the
         * machine. Firefox reads this from 140 and ignores it before that,
         * which `web-ext lint` notes against the 128 minimum kept here
         */
        data_collection_permissions: { required: ['none'] },
      },
    },
    web_accessible_resources: [
      {
        resources: ['viewer.html', 'icon/*', 'review-celebrate.png'],
        matches: ['https://github.com/*'],
      },
    ],
  },
});
