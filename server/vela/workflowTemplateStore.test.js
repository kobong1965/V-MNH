import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkflowTemplateStore } from './workflowTemplateStore.js';

test('workflow templates persist reusable structure and remove runtime results', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-workflows-'));
  try {
    const store = new WorkflowTemplateStore({ dataDirectory: directory });
    const saved = store.save({
      name: '商品图批量生成',
      nodes: [{
        id: 'source', type: 'Image', kind: 'image-input', x: 10, y: 20,
        prompt: '', status: 'success', resultUrl: 'data:image/png;base64,secret',
        lastFrame: '/generated/frame.png', generationProgress: 100,
        annotationText: '裤子商品参考图', annotationColor: '#a12118', annotationFontSize: 26
      }, {
        id: 'target', type: 'Image', kind: 'gpt-image', x: 500, y: 20,
        prompt: '生成商品图', status: 'error', errorMessage: 'old error', parentIds: ['source'],
        model: 'gpt-image-2', aspectRatio: '1:1', resolution: '2K'
      }],
      groups: [{
        id: 'group-1', nodeIds: ['source', 'target'], label: '首图工作流',
        labelColor: '#126b52', labelFontSize: 30
      }]
    });
    assert.equal(saved.nodes[0].status, 'idle');
    assert.equal(saved.nodes[0].resultUrl, undefined);
    assert.equal(saved.nodes[1].errorMessage, undefined);
    assert.deepEqual(saved.nodes[1].parentIds, ['source']);
    assert.equal(saved.nodes[0].annotationText, '裤子商品参考图');
    assert.equal(saved.nodes[0].annotationColor, '#a12118');
    assert.equal(saved.nodes[0].annotationFontSize, 26);
    assert.equal(saved.groups[0].label, '首图工作流');
    assert.equal(saved.groups[0].labelColor, '#126b52');
    assert.equal(saved.groups[0].labelFontSize, 30);
    assert.equal(store.list()[0].nodeCount, 2);
    assert.equal(store.get(saved.id).name, '商品图批量生成');
    assert.equal(store.delete(saved.id), true);
    assert.equal(store.get(saved.id), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
