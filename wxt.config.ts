import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifestVersion: 3,
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
