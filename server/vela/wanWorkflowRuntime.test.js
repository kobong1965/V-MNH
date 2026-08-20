import assert from 'node:assert/strict';
import test from 'node:test';

import { EcommerceWorkflowCatalog } from './ecommerceWorkflowCatalog.js';
import { injectWanWorkflowInputs } from './wanWorkflowRuntime.js';

test('Wan workflow injection updates only the contracted image and video widgets', () => {
  const catalog = new EcommerceWorkflowCatalog();
  const definition = catalog.getRuntimeDefinition('wan22-animate-face-outfit');
  const source = catalog.loadBackendWorkflow(definition.id);
  const originalVideo = source.nodes.find((node) => String(node.id) === '43').widgets_values.video;
  const injected = injectWanWorkflowInputs({
    workflow: source,
    definition,
    uploadedInputs: [
      { role: 'source-video', kind: 'video', remotePath: 'vela/job/source.mp4' },
      { role: 'character-image', kind: 'image', remotePath: 'vela/job/character.png' }
    ]
  });

  assert.equal(injected.nodes.find((node) => String(node.id) === '43').widgets_values.video, 'vela/job/source.mp4');
  assert.equal(injected.nodes.find((node) => String(node.id) === '44').widgets_values[0], 'vela/job/character.png');
  assert.equal(source.nodes.find((node) => String(node.id) === '43').widgets_values.video, originalVideo);
});

test('Wan workflow injection rejects missing or mismatched semantic inputs', () => {
  const catalog = new EcommerceWorkflowCatalog();
  const definition = catalog.getRuntimeDefinition('wan22-character-replace');
  const workflow = catalog.loadBackendWorkflow(definition.id);
  assert.throws(() => injectWanWorkflowInputs({
    workflow,
    definition,
    uploadedInputs: [{ role: 'source-video', kind: 'image', remotePath: 'bad.png' }]
  }), (error) => ['WORKFLOW_INPUT_TYPE_INVALID', 'WORKFLOW_INPUT_MISSING'].includes(error.code));
});
