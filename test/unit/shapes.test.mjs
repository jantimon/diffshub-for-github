import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as v from 'valibot';

import { mismatch, ThreadPage } from '../../src/page/shapes.ts';

const thread = {
  id: '2776953441',
  isResolved: false,
  resolvedBy: null,
  viewerCanReply: true,
  commentsData: { comments: [{ databaseId: 2776953441, body: 'hi', author: { login: 'octocat' } }] },
};

// GitHub has sent a page of threads both ways, and switched without notice
test('a page of threads reads as a bare list and as one wrapped in threads', () => {
  for (const page of [[thread], { threads: [thread], aliveChannel: 'x' }]) {
    const [read] = v.parse(ThreadPage, page);
    assert.equal(read.id, '2776953441');
    assert.equal(read.commentsData.comments[0].databaseId, '2776953441');
  }
});

test('a changed answer names the field that no longer fits', () => {
  const parsed = v.safeParse(ThreadPage, [{ ...thread, commentsData: {} }]);
  assert.equal(parsed.success, false);
  assert.match(mismatch(parsed.issues), /commentsData/);
});
