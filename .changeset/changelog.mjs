/**
 * Writes each changeset as a plain bullet. The default puts the commit hash in
 * front, which readers of the store listings and the release page cannot use.
 * The extension has no dependencies of its own to report, so that line stays
 * empty
 */
export default {
  getReleaseLine: async (changeset) => {
    const [first, ...rest] = changeset.summary.split('\n').map((line) => line.trimEnd());
    return [`- ${first}`, ...rest.map((line) => `  ${line}`)].join('\n');
  },
  getDependencyReleaseLine: async () => '',
};
