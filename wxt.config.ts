import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifestVersion: 3,
  // The submodule is a read-only reference and the screenshots are rebuilt on
  // every test run; neither belongs in the source archive AMO asks for.
  zip: {
    excludeSources: ['research/**', 'test/screenshots/**', 'test/.profile/**', '.firefox-profile/**'],
  },
  manifest: {
    name: 'DiffsHub for GitHub',
    description:
      'Opens GitHub pull request diffs in a fast, virtualized viewer. Every request goes to github.com from your own browser.',
    // The viewer is an extension page, so these permissions let it fetch the
    // patch on the user's own session cookie. Nothing else is contacted.
    host_permissions: ['https://github.com/*', 'https://*.githubusercontent.com/*'],
    action: { default_title: 'Open this pull request in DiffsHub' },
    browser_specific_settings: {
      gecko: {
        id: 'diffshub-for-github@jantimon.dev',
        strict_min_version: '128.0',
        // Required of every new Firefox extension. Nothing is collected: the
        // diff is fetched from github.com and rendered, and nothing leaves the
        // machine. Firefox reads this from 140 and ignores it before that,
        // which `web-ext lint` notes against the 128 minimum kept here.
        data_collection_permissions: { required: ['none'] },
      },
    },
    web_accessible_resources: [
      {
        resources: ['viewer.html', 'icon/*'],
        matches: ['https://github.com/*'],
      },
    ],
  },
});
