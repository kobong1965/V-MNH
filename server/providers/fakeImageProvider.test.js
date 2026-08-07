import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeImageProvider } from './fakeImageProvider.js';

test('FakeImageProvider returns a deterministic SVG asset without external calls', async () => {
  const provider = new FakeImageProvider();
  const result = await provider.generateImage({
    prompt: '9:16 夏季产品展示',
    aspectRatio: '9:16'
  });

  assert.equal(result.providerId, 'fake-image');
  assert.equal(result.mimeType, 'image/svg+xml');
  assert.equal(result.extension, 'svg');
  assert.ok(Buffer.isBuffer(result.data));
  assert.match(result.data.toString('utf8'), /9:16 夏季产品展示/);
  assert.match(result.data.toString('utf8'), /viewBox="0 0 720 1280"/);
});

test('FakeImageProvider rejects an empty prompt', async () => {
  const provider = new FakeImageProvider();

  await assert.rejects(
    () => provider.generateImage({ prompt: '   ' }),
    /prompt is required/i
  );
});
