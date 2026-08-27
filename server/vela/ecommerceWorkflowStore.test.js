import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EcommerceWorkflowCatalog, ECOMMERCE_WORKFLOW_MANIFEST } from './ecommerceWorkflowCatalog.js';
import { EcommerceWorkflowStore } from './ecommerceWorkflowStore.js';
import { ProjectStore } from './projectStore.js';

test('bundled e-commerce workflow library is empty after retiring the imported workflows', () => {
  const catalog = new EcommerceWorkflowCatalog();
  assert.deepEqual(ECOMMERCE_WORKFLOW_MANIFEST, []);
  assert.deepEqual(catalog.list(), []);
  assert.equal(catalog.has('wan22-animate-face-outfit'), false);
  assert.equal(catalog.has('wan22-character-replace'), false);
});

test('retired e-commerce workflows cannot be instantiated or deleted again', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-ecommerce-retired-'));
  try {
    const projectStore = new ProjectStore({ dataDirectory });
    const existingProject = projectStore.saveProject({
      name: '保留项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 }
    });
    const store = new EcommerceWorkflowStore({
      dataDirectory,
      projectStore,
      catalog: new EcommerceWorkflowCatalog()
    });

    assert.deepEqual(store.list(), []);
    assert.equal(store.createProject('wan22-animate-face-outfit'), null);
    assert.equal(store.delete('wan22-animate-face-outfit'), false);
    assert.equal(projectStore.getProject(existingProject.id)?.id, existingProject.id);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
