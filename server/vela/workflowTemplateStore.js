import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { assertNoPlaintextSecrets } from '../../shared/vela-contracts.js';
import { atomicWriteJson } from './projectStore.js';

const RUNTIME_NODE_KEYS = new Set([
  'resultUrl', 'lastFrame', 'inputUrl', 'errorMessage', 'generationProgress',
  'uploadProgress', 'uploadSource', 'jobGroupId', 'generationStartTime',
  'editorCanvasData', 'editorBackgroundUrl', 'detectedFaces', 'faceDetectionStatus',
  'characterReferenceUrls'
]);

const clonePlain = (value) => JSON.parse(JSON.stringify(value));

export const sanitizeWorkflowTemplateNodes = (nodes = []) => nodes.map((source) => {
  const node = clonePlain(source);
  for (const key of RUNTIME_NODE_KEYS) delete node[key];
  node.status = 'idle';
  if (Array.isArray(node.frameInputs)) {
    node.frameInputs = node.frameInputs.map(({ nodeId, order }) => ({ nodeId, order }));
  }
  return node;
});

const sanitizeGroups = (groups = []) => clonePlain(groups).map((group) => {
  if (group.storyContext) delete group.storyContext.compositeImageUrl;
  return group;
});

export class WorkflowTemplateStore {
  constructor({ dataDirectory, templatesDirectory } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.templatesDirectory = path.resolve(templatesDirectory || path.join(dataDirectory, 'workflows'));
    fs.mkdirSync(this.templatesDirectory, { recursive: true });
  }

  filePath(id) {
    if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) throw new Error('Invalid workflow id');
    return path.join(this.templatesDirectory, `${id}.json`);
  }

  save(draft = {}) {
    const name = String(draft.name || '').trim();
    if (!name) throw new Error('工作流名称不能为空');
    const now = new Date().toISOString();
    const id = draft.id || crypto.randomUUID();
    const existing = this.get(id);
    const template = {
      schemaVersion: 1,
      id,
      name: name.slice(0, 80),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      nodes: sanitizeWorkflowTemplateNodes(Array.isArray(draft.nodes) ? draft.nodes : []),
      groups: sanitizeGroups(Array.isArray(draft.groups) ? draft.groups : [])
    };
    assertNoPlaintextSecrets(template);
    atomicWriteJson(this.filePath(id), template);
    return template;
  }

  get(id) {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return null;
    const template = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertNoPlaintextSecrets(template);
    return template;
  }

  list() {
    return fs.readdirSync(this.templatesDirectory)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        try {
          const template = this.get(path.basename(file, '.json'));
          return template ? [{
            id: template.id,
            name: template.name,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
            nodeCount: template.nodes.length
          }] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  delete(id) {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}
