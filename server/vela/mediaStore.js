import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './projectStore.js';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const extensionForMime = (mime) => ({
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}[mime] || 'png');

export class ProjectMediaStore {
  constructor(projectStore, { fetchImpl = globalThis.fetch } = {}) {
    this.projectStore = projectStore;
    this.fetch = fetchImpl;
  }

  indexPath(projectId) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    return path.join(directory, 'media-index.json');
  }

  list(projectId) {
    const indexPath = this.indexPath(projectId);
    if (!fs.existsSync(indexPath)) return [];
    const records = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(records) ? records : [];
  }

  get(projectId, mediaId) {
    return this.list(projectId).find((item) => item.id === mediaId) || null;
  }

  resolveFile(projectId, mediaId) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    const record = this.get(projectId, mediaId);
    if (!directory || !record) return null;
    const resolved = path.resolve(directory, record.relativePath);
    if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Media path escapes project');
    return { record, filePath: resolved };
  }

  readReference(projectId, url) {
    const match = String(url || '').match(/^\/api\/vela\/projects\/([^/]+)\/media\/([^/]+)\/file$/);
    if (!match || match[1] !== projectId) throw new Error('参考图必须来自当前 Vela 项目');
    const resolved = this.resolveFile(projectId, match[2]);
    if (!resolved || !fs.existsSync(resolved.filePath)) throw new Error('参考图不存在');
    return {
      data: fs.readFileSync(resolved.filePath),
      mime: resolved.record.mime || 'image/png',
      filename: path.basename(resolved.filePath)
    };
  }

  async materializeImage(result) {
    if (result.kind === 'base64') return { data: Buffer.from(result.value, 'base64'), mime: 'image/png' };
    if (result.kind !== 'url') throw new Error('Unsupported provider image result');
    const response = await this.fetch(result.value, { redirect: 'follow' });
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    return { data, mime: response.headers.get('content-type')?.split(';')[0] || 'image/png' };
  }

  async saveProviderImage(projectId, result, metadata = {}) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    const { data, mime } = await this.materializeImage(result);
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error('图片文件为空或超过 50MB');
    const id = crypto.randomUUID();
    const relativePath = `outputs/images/${id}.${extensionForMime(mime)}`;
    atomicWriteFile(path.join(directory, ...relativePath.split('/')), data);
    const record = {
      id,
      projectId,
      kind: 'image',
      relativePath,
      mime,
      bytes: data.length,
      sha256: sha256(data),
      createdAt: new Date().toISOString(),
      source: {
        profileId: metadata.profileId,
        model: metadata.model,
        nodeId: metadata.nodeId,
        revisedPrompt: result.revisedPrompt
      }
    };
    const indexPath = this.indexPath(projectId);
    atomicWriteJson(indexPath, [...this.list(projectId), record]);
    return { ...record, url: `/api/vela/projects/${projectId}/media/${id}/file` };
  }
}
