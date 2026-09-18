import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'DiffsHub for GitHub',
    description:
      'Opens GitHub pull request diffs in a fast, virtualized viewer. Every request goes to github.com from your own browser.',
    // The viewer is an extension page, so these permissions let it fetch the
    // patch on the user's own session cookie. Nothing else is contacted.
    host_permissions: ['https://github.com/*', 'https://*.githubusercontent.com/*'],
    web_accessible_resources: [
      {
        resources: ['viewer.html'],
        matches: ['https://github.com/*'],
      },
    ],
  },
});
