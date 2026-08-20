import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EcommerceWorkflowCatalog, ECOMMERCE_WORKFLOW_MANIFEST } from './ecommerceWorkflowCatalog.js';
import { EcommerceWorkflowStore } from './ecommerceWorkflowStore.js';
import { ProjectStore } from './projectStore.js';

test('bundled e-commerce catalog exposes ten simplified input canvases with explicit engines', () => {
  const catalog = new EcommerceWorkflowCatalog();
  const workflows = catalog.list();
  assert.equal(workflows.length, 10);
  assert.equal(ECOMMERCE_WORKFLOW_MANIFEST.length, 10);
  assert.equal(new Set(workflows.map((workflow) => workflow.id)).size, 10);
  assert.equal(new Set(workflows.map((workflow) => workflow.sourceHash)).size, 10);
  assert.equal(workflows.find((workflow) => workflow.id === 'qwen-multiview-character')?.backendNodeCount, 404);
  assert.equal(workflows.filter((workflow) => workflow.engine === 'gpt-image').length, 8);
  assert.equal(workflows.filter((workflow) => workflow.engine === 'wan-video-process').length, 2);

  for (const workflow of workflows) {
    assert.equal(workflow.nodeCount, workflow.inputCount + 1);
    assert.ok(workflow.backendNodeCount > workflow.nodeCount);
    const nodeIds = new Set(workflow.preview.nodes.map((node) => node.id));
    assert.equal(nodeIds.size, workflow.nodeCount);
    for (const link of workflow.preview.links) {
      assert.ok(nodeIds.has(link.from));
      assert.ok(nodeIds.has(link.to));
    }
  }
});

test('e-commerce workflow deletion persists without touching bundles or created projects', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-ecommerce-'));
  try {
    const projectStore = new ProjectStore({ dataDirectory });
    const catalog = new EcommerceWorkflowCatalog();
    const store = new EcommerceWorkflowStore({ dataDirectory, projectStore, catalog });
    const before = store.list();
    const deleted = before[0];
    const createdFrom = before[1];

    const project = store.createProject(createdFrom.id);
    assert.ok(project);
    assert.equal(project.name, createdFrom.name);
    assert.equal(project.nodes.length, createdFrom.nodeCount);
    assert.equal(project.settings.importedWorkflow.id, createdFrom.id);
    assert.equal(project.settings.importedWorkflow.engine, createdFrom.engine);
    assert.equal(project.nodes.filter((node) => node.kind === createdFrom.engine).length, 1);
    assert.equal(project.nodes.some((node) => node.model === 'comfyui-import'), false);
    const projectNodeIds = new Set(project.nodes.map((node) => node.id));
    for (const node of project.nodes) {
      for (const parentId of node.parentIds || []) assert.ok(projectNodeIds.has(parentId));
    }

    assert.equal(store.delete(deleted.id), true);
    assert.equal(store.delete(deleted.id), false);
    assert.equal(store.list().length, 9);
    assert.equal(store.createProject(deleted.id), null);

    const restarted = new EcommerceWorkflowStore({ dataDirectory, projectStore, catalog });
    assert.equal(restarted.list().some((workflow) => workflow.id === deleted.id), false);
    assert.ok(projectStore.getProject(project.id));
    assert.ok(fs.existsSync(path.join(catalog.bundlesDirectory, ECOMMERCE_WORKFLOW_MANIFEST[0].file)));
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('Wan workflows map only the required frontend media roles to fixed backend nodes', () => {
  const catalog = new EcommerceWorkflowCatalog();
  const animate = catalog.getRuntimeDefinition('wan22-animate-face-outfit');
  const replace = catalog.getRuntimeDefinition('wan22-character-replace');

  assert.deepEqual(
    animate.inputs.map(({ role, kind, backendNodeId }) => ({ role, kind, backendNodeId })),
    [
      { role: 'source-video', kind: 'video', backendNodeId: '43' },
      { role: 'character-image', kind: 'image', backendNodeId: '44' }
    ]
  );
  assert.deepEqual(
    replace.inputs.map(({ role, kind, backendNodeId }) => ({ role, kind, backendNodeId })),
    [
      { role: 'source-video', kind: 'video', backendNodeId: '618' },
      { role: 'character-image', kind: 'image', backendNodeId: '617' }
    ]
  );
});

test('Wan workflows use portable public model filenames instead of machine-local aliases', () => {
  const catalog = new EcommerceWorkflowCatalog();
  const animate = catalog.loadBackendWorkflow('wan22-animate-face-outfit');
  const replace = catalog.loadBackendWorkflow('wan22-character-replace');
  const widget = (workflow, nodeId) => workflow.nodes.find((node) => String(node.id) === nodeId)?.widgets_values?.[0];

  assert.equal(widget(animate, '41'), 'clip_vision_h.safetensors');
  assert.equal(widget(animate, '57'), 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors');
  assert.equal(widget(replace, '589'), 'clip_vision_h.safetensors');
  assert.equal(widget(replace, '595'), 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors');
  assert.equal(widget(replace, '596'), 'WanAnimate_relight_lora_fp16.safetensors');
});
