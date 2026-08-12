import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { assertNoPlaintextSecrets } from '../../shared/vela-contracts.js';
import { atomicWriteFile, atomicWriteJson } from './projectStore.js';

const RUNTIME_NODE_KEYS = new Set([
  'errorMessage', 'generationProgress', 'uploadProgress', 'uploadSource', 'jobGroupId',
  'generationStartTime', 'editorCanvasData', 'detectedFaces', 'faceDetectionStatus'
]);
const MEDIA_KEYS = new Set([
  'resultUrl', 'resultUrls', 'lastFrame', 'inputUrl', 'editorBackgroundUrl',
  'characterReferenceUrls', 'compositeImageUrl'
]);
const PROJECT_MEDIA_PATTERN = /^\/api\/vela\/projects\/([^/]+)\/media\/([^/]+)\/file$/;
const WORKFLOW_MEDIA_PATTERN = /^vela-workflow-media:([a-f0-9-]{36})$/i;

const clonePlain = (value) => JSON.parse(JSON.stringify(value));
const extensionFromRecord = (record) => path.extname(String(record?.relativePath || '')).replace(/^\./, '') || 'bin';

export const sanitizeWorkflowTemplateNodes = (nodes = [], { preserveMedia = false } = {}) => nodes.map((source) => {
  const node = clonePlain(source);
  for (const key of RUNTIME_NODE_KEYS) delete node[key];
  if (!preserveMedia) {
    for (const key of MEDIA_KEYS) delete node[key];
  }
  node.status = preserveMedia && (node.resultUrl || node.inputUrl) ? 'success' : 'idle';
  if (Array.isArray(node.frameInputs)) {
    node.frameInputs = node.frameInputs.map(({ nodeId, order }) => ({ nodeId, order }));
  }
  return node;
});

const sanitizeGroups = (groups = [], { preserveMedia = false } = {}) => clonePlain(groups).map((group) => {
  if (!preserveMedia && group.storyContext) delete group.storyContext.compositeImageUrl;
  return group;
});

export class WorkflowTemplateStore {
  constructor({ dataDirectory, templatesDirectory, projectMediaStore } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.templatesDirectory = path.resolve(templatesDirectory || path.join(dataDirectory, 'workflows'));
    this.assetsDirectory = path.join(this.templatesDirectory, 'assets');
    this.projectMediaStore = projectMediaStore;
    fs.mkdirSync(this.templatesDirectory, { recursive: true });
    fs.mkdirSync(this.assetsDirectory, { recursive: true });
  }

  filePath(id) {
    if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) throw new Error('Invalid workflow id');
    return path.join(this.templatesDirectory, `${id}.json`);
  }

  assetDirectory(id) {
    this.filePath(id);
    return path.join(this.assetsDirectory, id);
  }

  bundleMedia(value, { sourceProjectId, templateId, assets, tokenByUrl }) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((item) => this.bundleMedia(item, { sourceProjectId, templateId, assets, tokenByUrl }))
        .filter((item) => item !== undefined);
    }
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!MEDIA_KEYS.has(key)) {
        result[key] = this.bundleMedia(item, { sourceProjectId, templateId, assets, tokenByUrl });
        continue;
      }
      const values = Array.isArray(item) ? item : [item];
      const bundled = values.flatMap((url) => {
        if (typeof url !== 'string' || !url) return [];
        const match = url.match(PROJECT_MEDIA_PATTERN);
        if (!match) return [];
        if (!sourceProjectId) throw new Error('Save the current project before bundling workflow materials');
        if (match[1] !== sourceProjectId) throw new Error('Workflow materials must belong to the current project');
        if (tokenByUrl.has(url)) return [tokenByUrl.get(url)];
        if (!this.projectMediaStore) throw new Error('Workflow material storage is not configured');
        const resolved = this.projectMediaStore.resolveFile(sourceProjectId, match[2]);
        if (!resolved || !fs.existsSync(resolved.filePath)) throw new Error('A workflow material file is missing');
        const assetId = crypto.randomUUID();
        const extension = extensionFromRecord(resolved.record);
        const relativePath = `${templateId}/${assetId}.${extension}`;
        const data = fs.readFileSync(resolved.filePath);
        atomicWriteFile(path.join(this.assetsDirectory, ...relativePath.split('/')), data);
        const token = `vela-workflow-media:${assetId}`;
        tokenByUrl.set(url, token);
        assets.push({
          id: assetId,
          relativePath,
          kind: resolved.record.kind,
          mime: resolved.record.mime,
          bytes: data.length,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
          fileName: path.basename(resolved.record.relativePath)
        });
        return [token];
      });
      if (Array.isArray(item)) {
        if (bundled.length) result[key] = bundled;
      } else if (bundled[0]) {
        result[key] = bundled[0];
      }
    }
    return result;
  }

  save(draft = {}) {
    const name = String(draft.name || '').trim();
    if (!name) throw new Error('Workflow name is required');
    const now = new Date().toISOString();
    const id = draft.id || crypto.randomUUID();
    const existing = this.get(id);
    const assets = [];
    const bundleContext = {
      sourceProjectId: draft.projectId ? String(draft.projectId) : '',
      templateId: id,
      assets,
      tokenByUrl: new Map()
    };
    try {
      const template = {
        schemaVersion: 2,
        id,
        name: name.slice(0, 80),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        nodes: this.bundleMedia(
          sanitizeWorkflowTemplateNodes(Array.isArray(draft.nodes) ? draft.nodes : [], { preserveMedia: true }),
          bundleContext
        ),
        groups: this.bundleMedia(
          sanitizeGroups(Array.isArray(draft.groups) ? draft.groups : [], { preserveMedia: true }),
          bundleContext
        ),
        assets
      };
      assertNoPlaintextSecrets(template);
      atomicWriteJson(this.filePath(id), template);
      return template;
    } catch (error) {
      if (!existing) fs.rmSync(this.assetDirectory(id), { recursive: true, force: true });
      throw error;
    }
  }

  get(id) {
    const file = this.filePath(id);
    if (!fs.existsSync(file)) return null;
    const template = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertNoPlaintextSecrets(template);
    return template;
  }

  instantiate(id, { projectId } = {}) {
    const template = this.get(id);
    if (!template) return null;
    const assets = Array.isArray(template.assets) ? template.assets : [];
    if (assets.length && !projectId) throw new Error('Target project is required for workflow materials');
    const urlByAssetId = new Map();
    for (const asset of assets) {
      const filePath = path.resolve(this.assetsDirectory, asset.relativePath);
      if (!filePath.startsWith(`${path.resolve(this.assetDirectory(id))}${path.sep}`)) {
        throw new Error('Workflow material path escapes its bundle');
      }
      if (!fs.existsSync(filePath)) throw new Error('A workflow material file is missing');
      const media = this.projectMediaStore.saveCopiedMedia(projectId, {
        data: fs.readFileSync(filePath),
        mime: asset.mime,
        fileName: asset.fileName,
        source: { templateId: id, templateAssetId: asset.id }
      });
      urlByAssetId.set(asset.id, media.url);
    }
    const hydrate = (value) => {
      if (typeof value === 'string') {
        const match = value.match(WORKFLOW_MEDIA_PATTERN);
        return match ? urlByAssetId.get(match[1]) || value : value;
      }
      if (Array.isArray(value)) return value.map(hydrate);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
      }
      return value;
    };
    return hydrate(template);
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
            nodeCount: template.nodes.length,
            assetCount: Array.isArray(template.assets) ? template.assets.length : 0
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
    fs.rmSync(this.assetDirectory(id), { recursive: true, force: true });
    return true;
  }
}
