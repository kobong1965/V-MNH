import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteFile, atomicWriteJson } from './projectStore.js';
import { ProviderError } from '../providers/openAiCompatibleProvider.js';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const RETRYABLE_DOWNLOAD_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const extensionForMime = (mime) => ({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v'
}[mime]);

const parseMediaDataUrl = (value) => {
  const match = String(value || '').match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('上传内容不是有效的媒体文件');
  const mime = match[1].toLowerCase();
  const extension = extensionForMime(mime);
  if (!extension || (!mime.startsWith('image/') && !mime.startsWith('video/'))) {
    throw new Error(`不支持的媒体格式：${mime}`);
  }
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > MAX_UPLOAD_BYTES) throw new Error('媒体文件为空或超过 100MB');
  return { data, mime, extension, kind: mime.startsWith('video/') ? 'video' : 'image' };
};

export class ProjectMediaStore {
  constructor(projectStore, {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    this.projectStore = projectStore;
    this.fetch = fetchImpl;
    this.sleep = sleep;
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

  async materializeProviderResult(result, {
    allowBase64 = false,
    fallbackMime = 'application/octet-stream',
    headers = {}
  } = {}) {
    if (allowBase64 && result.kind === 'base64') return { data: Buffer.from(result.value, 'base64'), mime: fallbackMime };
    if (result.kind !== 'url') throw new Error('Unsupported provider media result');
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await this.fetch(result.value, { redirect: 'follow', headers, signal: controller.signal });
        if (!response.ok) {
          throw new ProviderError(`生成结果下载失败：HTTP ${response.status}`, {
            code: 'RESULT_DOWNLOAD_FAILED',
            status: response.status,
            retryable: RETRYABLE_DOWNLOAD_STATUSES.has(response.status),
            safeToRetry: true
          });
        }
        const data = Buffer.from(await response.arrayBuffer());
        return { data, mime: response.headers.get('content-type')?.split(';')[0] || fallbackMime };
      } catch (error) {
        lastError = error instanceof ProviderError
          ? error
          : new ProviderError(error?.name === 'AbortError' ? '生成结果下载超时' : `生成结果下载失败：${error?.message || '网络错误'}`, {
            code: 'RESULT_DOWNLOAD_FAILED',
            retryable: true,
            safeToRetry: true,
            details: { networkCode: error?.cause?.code || error?.code }
          });
      } finally {
        clearTimeout(timer);
      }
      if (!lastError.retryable || attempt === 2) throw lastError;
      await this.sleep(250 * (2 ** attempt));
    }
    throw lastError;
  }

  saveUploadedMedia(projectId, { dataUrl, fileName } = {}) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    const media = parseMediaDataUrl(dataUrl);
    const id = crypto.randomUUID();
    const relativePath = `inputs/${media.kind}s/${id}.${media.extension}`;
    atomicWriteFile(path.join(directory, ...relativePath.split('/')), media.data);
    const record = {
      id,
      projectId,
      kind: media.kind,
      relativePath,
      mime: media.mime,
      bytes: media.data.length,
      sha256: sha256(media.data),
      createdAt: new Date().toISOString(),
      source: {
        type: 'canvas-upload',
        fileName: String(fileName || '未命名素材').slice(0, 255)
      }
    };
    const indexPath = this.indexPath(projectId);
    atomicWriteJson(indexPath, [...this.list(projectId), record]);
    return { ...record, url: `/api/vela/projects/${projectId}/media/${id}/file` };
  }

  saveCopiedMedia(projectId, { data, mime, fileName, source = {} } = {}) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    const normalizedMime = String(mime || '').toLowerCase();
    const extension = extensionForMime(normalizedMime);
    const kind = normalizedMime.startsWith('video/') ? 'video' : normalizedMime.startsWith('image/') ? 'image' : null;
    if (!extension || !kind) throw new Error(`Unsupported workflow material format: ${normalizedMime || 'unknown'}`);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
    const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!buffer.length || buffer.length > maxBytes) {
      throw new Error(`Workflow ${kind} material is empty or exceeds the size limit`);
    }
    const id = crypto.randomUUID();
    const relativePath = `inputs/${kind}s/${id}.${extension}`;
    atomicWriteFile(path.join(directory, ...relativePath.split('/')), buffer);
    const record = {
      id,
      projectId,
      kind,
      relativePath,
      mime: normalizedMime,
      bytes: buffer.length,
      sha256: sha256(buffer),
      createdAt: new Date().toISOString(),
      source: {
        type: 'workflow-template',
        fileName: String(fileName || `workflow-material.${extension}`).slice(0, 255),
        ...source
      }
    };
    const indexPath = this.indexPath(projectId);
    atomicWriteJson(indexPath, [...this.list(projectId), record]);
    return { ...record, url: `/api/vela/projects/${projectId}/media/${id}/file` };
  }

  async saveProviderImage(projectId, result, metadata = {}, downloadOptions = {}) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    const { data, mime } = await this.materializeProviderResult(result, {
      allowBase64: true,
      fallbackMime: 'image/png',
      ...downloadOptions
    });
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error('图片文件为空或超过 50MB');
    const id = crypto.randomUUID();
    const relativePath = `outputs/images/${id}.${extensionForMime(mime) || 'png'}`;
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

  async saveProviderVideo(projectId, result, metadata = {}, downloadOptions = {}) {
    const directory = this.projectStore.findProjectDirectory(projectId);
    if (!directory) throw new Error(`Project not found: ${projectId}`);
    const materialized = await this.materializeProviderResult(result, {
      fallbackMime: 'video/mp4',
      ...downloadOptions
    });
    const mime = materialized.mime.startsWith('video/') ? materialized.mime : 'video/mp4';
    const data = materialized.data;
    if (!data.length || data.length > MAX_VIDEO_BYTES) throw new Error('视频文件为空或超过 512MB');
    const id = crypto.randomUUID();
    const relativePath = `outputs/videos/${id}.${extensionForMime(mime) || 'mp4'}`;
    atomicWriteFile(path.join(directory, ...relativePath.split('/')), data);
    const record = {
      id,
      projectId,
      kind: 'video',
      relativePath,
      mime,
      bytes: data.length,
      sha256: sha256(data),
      createdAt: new Date().toISOString(),
      source: {
        profileId: metadata.profileId,
        model: metadata.model,
        nodeId: metadata.nodeId,
        taskId: metadata.taskId
      }
    };
    const indexPath = this.indexPath(projectId);
    atomicWriteJson(indexPath, [...this.list(projectId), record]);
    return { ...record, url: `/api/vela/projects/${projectId}/media/${id}/file` };
  }
}
