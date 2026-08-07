import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeVideoProvider } from './fakeVideoProvider.js';

test('FakeVideoProvider returns an H3 preview artifact without external calls', async () => {
  const provider = new FakeVideoProvider();
  const result = await provider.generateVideo({
    prompt: '竖屏产品展示视频',
    aspectRatio: '9:16'
  });

  assert.equal(result.providerId, 'fake-h3-video');
  assert.equal(result.mimeType, 'image/svg+xml');
  assert.match(result.data.toString('utf8'), /竖屏产品展示视频/);
  assert.match(result.data.toString('utf8'), /viewBox="0 0 720 1280"/);
});

test('FakeVideoProvider rejects an empty prompt', async () => {
  const provider = new FakeVideoProvider();
  await assert.rejects(() => provider.generateVideo({ prompt: '' }), /prompt is required/i);
});
