import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canConnectNodeKinds,
  getNodeDefinition,
  isKnownVelaNodeKind,
  VELA_NODE_CATALOG,
  VELA_QUICK_ADD_CATALOG
} from './nodeCatalog.ts';

test('quick add exposes only prompt, image and video blocks', () => {
  assert.deepEqual(
    VELA_QUICK_ADD_CATALOG.map(({ label, kind }) => ({ label, kind })),
    [
      { label: '提示词', kind: 'prompt' },
      { label: '图片', kind: 'gpt-image' },
      { label: '视频', kind: 'gpt-video' }
    ]
  );
});

test('Vela catalog exposes only the first-version canvas nodes', () => {
  assert.deepEqual(
    VELA_NODE_CATALOG.map((node) => node.kind),
    [
      'prompt',
      'image-input',
      'video-input',
      'storyworks-reference',
      'gpt-prompt-optimizer',
      'video-director',
      'competitor-script-analyzer',
      'gpt-image',
      'gpt-video',
      'h3-video',
      'wan-video-process',
      'image-result',
      'video-result'
    ]
  );
});

test('node definitions carry Chinese labels and legacy canvas mappings', () => {
  const h3Node = getNodeDefinition('h3-video');

  assert.equal(h3Node.label, 'H3 R2V 视频');
  assert.equal(h3Node.legacyType, 'Video');
  assert.deepEqual(h3Node.inputs, ['text', 'image', 'image-list']);
});

test('Storyworks references are supported as read-only continuity inputs', () => {
  const reference = getNodeDefinition('storyworks-reference');

  assert.equal(reference.label, 'Storyworks 参考');
  assert.equal(reference.category, 'input');
  assert.equal(reference.userCreatable, false);
  assert.deepEqual(reference.outputs, ['text', 'image']);
  assert.equal(canConnectNodeKinds('storyworks-reference', 'gpt-image'), true);
});

test('unknown node kinds fall back without crashing the canvas', () => {
  assert.equal(isKnownVelaNodeKind('storyworks-reference'), true);
  assert.equal(isKnownVelaNodeKind('future-plugin-node'), false);
  assert.doesNotThrow(() => getNodeDefinition('future-plugin-node'));
  assert.match(getNodeDefinition('future-plugin-node').description, /原始内容已安全保留/);
});

test('typed ports allow the approved GPT to H3 workflow', () => {
  assert.equal(canConnectNodeKinds('prompt', 'gpt-prompt-optimizer'), true);
  assert.equal(canConnectNodeKinds('prompt', 'gpt-image'), true);
  assert.equal(canConnectNodeKinds('gpt-image', 'h3-video'), true);
  assert.equal(canConnectNodeKinds('gpt-image', 'gpt-video'), true);
  assert.equal(canConnectNodeKinds('image-input', 'h3-video'), true);
  assert.equal(canConnectNodeKinds('image-input', 'gpt-video'), true);
  assert.equal(canConnectNodeKinds('image-input', 'video-director'), true);
  assert.equal(canConnectNodeKinds('image-input', 'competitor-script-analyzer'), true);
  assert.equal(canConnectNodeKinds('video-result', 'competitor-script-analyzer'), true);
  assert.equal(canConnectNodeKinds('video-input', 'wan-video-process'), true);
  assert.equal(canConnectNodeKinds('image-input', 'wan-video-process'), true);
  assert.equal(canConnectNodeKinds('video-director', 'gpt-video'), true);
});

test('typed ports reject backwards and unsupported connections', () => {
  assert.equal(canConnectNodeKinds('h3-video', 'gpt-image'), false);
  assert.equal(canConnectNodeKinds('image-input', 'prompt'), false);
  assert.equal(canConnectNodeKinds('video-result', 'gpt-prompt-optimizer'), false);
});
