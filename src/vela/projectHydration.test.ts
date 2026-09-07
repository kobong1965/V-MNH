import assert from 'node:assert/strict';
import test from 'node:test';

import type { NodeData } from '../types.ts';
import { hydrateLoadedVelaNode } from './projectHydration.ts';

const createNode = (patch: Partial<NodeData>): NodeData => ({
  id: 'node-1',
  type: 'Image' as NodeData['type'],
  x: 0,
  y: 0,
  prompt: '',
  status: 'idle' as NodeData['status'],
  model: '',
  aspectRatio: '1:1',
  resolution: '2K',
  ...patch
});

test('an interrupted local canvas upload becomes a retryable visible error after reload', () => {
  const hydrated = hydrateLoadedVelaNode(createNode({
    id: 'upload-1',
    kind: 'image-input',
    status: 'loading' as NodeData['status'],
    uploadSource: 'canvas-drop',
    uploadProgress: 42
  }));

  assert.equal(hydrated.status, 'error');
  assert.equal(hydrated.uploadProgress, undefined);
  assert.match(hydrated.errorMessage || '', /上传已中断.*重新上传/);
});

test('a durable generation loading state remains eligible for job recovery', () => {
  const node = createNode({ id: 'job-1', kind: 'gpt-image', status: 'loading' as NodeData['status'] });
  assert.deepEqual(hydrateLoadedVelaNode(node), node);
});
