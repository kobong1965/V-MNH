import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFeedOptions, normalizeUpdateConfig, redactUpdateError } from './updateConfig.js';

test('GitHub update config accepts safe owner and repository names', () => {
  assert.deepEqual(normalizeUpdateConfig({ owner: 'kobong1965', repo: 'V-MNH', privateRepository: true }), {
    owner: 'kobong1965', repo: 'V-MNH', privateRepository: true
  });
  assert.throws(() => normalizeUpdateConfig({ owner: '../bad', repo: 'V-MNH' }), /格式不正确/);
});

test('private feed includes a runtime token without persisting it in public config', () => {
  const feed = buildFeedOptions({ owner: 'team', repo: 'app', privateRepository: true }, 'github-secret');
  assert.equal(feed.token, 'github-secret');
  assert.equal(feed.private, true);
  assert.equal('token' in buildFeedOptions({ owner: 'team', repo: 'app', privateRepository: false }, 'github-secret'), false);
});

test('update errors redact tokens', () => {
  assert.doesNotMatch(redactUpdateError(new Error('token=github-secret failed'), ['github-secret']), /github-secret/);
});
