import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './projectStore.js';
import { getDefaultEcommerceWorkflowCatalog } from './ecommerceWorkflowCatalog.js';

const STATE_VERSION = 1;

export class EcommerceWorkflowStore {
  constructor({ dataDirectory, projectStore, catalog } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    if (!projectStore) throw new Error('projectStore is required');
    this.projectStore = projectStore;
    this.catalog = catalog || getDefaultEcommerceWorkflowCatalog();
    this.statePath = path.join(path.resolve(dataDirectory), 'ecommerce-workflow-library.json');
    this.deletedIds = this.readDeletedIds();
  }

  readDeletedIds() {
    if (!fs.existsSync(this.statePath)) return new Set();
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (state?.version !== STATE_VERSION || !Array.isArray(state.deletedIds)) return new Set();
      return new Set(state.deletedIds.filter((id) => typeof id === 'string' && this.catalog.has(id)));
    } catch {
      return new Set();
    }
  }

  persist() {
    atomicWriteJson(this.statePath, {
      version: STATE_VERSION,
      deletedIds: [...this.deletedIds].sort(),
      updatedAt: new Date().toISOString()
    });
  }

  list() {
    return this.catalog.list().filter((workflow) => !this.deletedIds.has(workflow.id));
  }

  createProject(workflowId) {
    if (this.deletedIds.has(workflowId)) return null;
    const draft = this.catalog.instantiate(workflowId);
    return draft ? this.projectStore.saveProject(draft) : null;
  }

  delete(workflowId) {
    if (!this.catalog.has(workflowId) || this.deletedIds.has(workflowId)) return false;
    this.deletedIds.add(workflowId);
    this.persist();
    return true;
  }
}
