import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canConnectNodeKinds,
  getNodeDefinition,
  VELA_NODE_CATALOG
} from './nodeCatalog.ts';

test('Vela catalog exposes only the first-version canvas nodes', () => {
  assert.deepEqual(
    VELA_NODE_CATALOG.map((node) => node.kind),
    [
      'prompt',
      'image-input',
      'gpt-prompt-optimizer',
      'gpt-image',
      'h3-video',
      'image-result',
      'video-result'
    ]
  );
});

test('node definitions carry Chinese labels and legacy canvas mappings', () => {
  const h3Node = getNodeDefinition('h3-video');

  assert.equal(h3Node.label, 'H3 视频');
  assert.equal(h3Node.legacyType, 'Video');
  assert.deepEqual(h3Node.inputs, ['text', 'image']);
});

test('typed ports allow the approved GPT to H3 workflow', () => {
  assert.equal(canConnectNodeKinds('prompt', 'gpt-prompt-optimizer'), true);
  assert.equal(canConnectNodeKinds('prompt', 'gpt-image'), true);
  assert.equal(canConnectNodeKinds('gpt-image', 'h3-video'), true);
  assert.equal(canConnectNodeKinds('image-input', 'h3-video'), true);
});

test('typed ports reject backwards and unsupported connections', () => {
  assert.equal(canConnectNodeKinds('h3-video', 'gpt-image'), false);
  assert.equal(canConnectNodeKinds('image-input', 'prompt'), false);
  assert.equal(canConnectNodeKinds('video-result', 'gpt-prompt-optimizer'), false);
});
