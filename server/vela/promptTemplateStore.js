import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './projectStore.js';

const clonePlain = (value) => JSON.parse(JSON.stringify(value));
const MAX_EFFECT_IMAGE_BYTES = 10 * 1024 * 1024;
const EFFECT_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

const isExpectedImageBytes = (mime, bytes) => {
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

const decodeEffectImage = (value) => {
  if (!value) return null;
  const name = String(value.name || '').trim().slice(0, 160) || '效果图';
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value.data || ''));
  const mime = match?.[1]?.toLowerCase();
  if (!match || !mime || !EFFECT_IMAGE_TYPES.has(mime)) throw new Error('效果图必须是 PNG、JPG 或 WebP 图片');
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length > MAX_EFFECT_IMAGE_BYTES) throw new Error('效果图不能超过 10MB');
  if (!bytes.length || !isExpectedImageBytes(mime, bytes)) throw new Error('效果图不是有效的图片文件');
  return { name, mime, bytes, extension: EFFECT_IMAGE_TYPES.get(mime) };
};

export class PromptTemplateStore {
  constructor({ dataDirectory, maxTemplates = 200 } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.promptDirectory = path.join(path.resolve(dataDirectory), 'prompts');
    this.filePath = path.join(this.promptDirectory, 'templates.json');
    this.effectImageDirectory = path.join(this.promptDirectory, 'effect-images');
    this.maxTemplates = Math.max(1, Number(maxTemplates) || 200);
  }

  readAll() {
    if (!fs.existsSync(this.filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('提示词模板文件格式不正确');
    return parsed.filter((item) => (
      item
      && /^[a-f0-9-]{36}$/i.test(String(item.id || ''))
      && typeof item.name === 'string'
      && typeof item.text === 'string'
      && typeof item.createdAt === 'string'
      && typeof item.updatedAt === 'string'
    ));
  }

  list() {
    return clonePlain(this.readAll()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((template) => this.toPublic(template)));
  }

  save(draft = {}) {
    const name = String(draft.name || '').trim();
    const text = String(draft.text || '').trim();
    if (!name) throw new Error('提示词名称不能为空');
    if (!text) throw new Error('提示词内容不能为空');
    if (text.length > 4000) throw new Error('提示词内容不能超过 4000 字');
    const templates = this.readAll();
    if (templates.length >= this.maxTemplates) throw new Error(`最多保存 ${this.maxTemplates} 条提示词，请先删除不再使用的模板`);
    const decodedEffectImage = decodeEffectImage(draft.effectImage);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const template = {
      id,
      name: name.slice(0, 80),
      text,
      createdAt: now,
      updatedAt: now,
      ...(decodedEffectImage ? {
        effectImage: {
          name: decodedEffectImage.name,
          mime: decodedEffectImage.mime,
          bytes: decodedEffectImage.bytes.length,
          fileName: `${id}.${decodedEffectImage.extension}`
        }
      } : {})
    };
    let imagePath = null;
    try {
      if (decodedEffectImage) {
        fs.mkdirSync(this.effectImageDirectory, { recursive: true });
        imagePath = path.join(this.effectImageDirectory, template.effectImage.fileName);
        fs.writeFileSync(imagePath, decodedEffectImage.bytes, { flag: 'wx' });
      }
      atomicWriteJson(this.filePath, [template, ...templates]);
    } catch (error) {
      if (imagePath) fs.rmSync(imagePath, { force: true });
      throw error;
    }
    return clonePlain(this.toPublic(template));
  }

  toPublic(template) {
    const publicTemplate = { ...template };
    if (template.effectImage) {
      publicTemplate.effectImage = {
        name: template.effectImage.name,
        mime: template.effectImage.mime,
        bytes: template.effectImage.bytes,
        url: `/api/vela/prompt-templates/${template.id}/effect-image`
      };
    }
    return publicTemplate;
  }

  resolveEffectImage(id) {
    const templateId = String(id || '');
    if (!/^[a-f0-9-]{36}$/i.test(templateId)) throw new Error('提示词模板 ID 无效');
    const template = this.readAll().find((item) => item.id === templateId);
    if (!template?.effectImage?.fileName) return null;
    const safeFileName = path.basename(String(template.effectImage.fileName));
    const filePath = path.join(this.effectImageDirectory, safeFileName);
    if (!fs.existsSync(filePath)) return null;
    return {
      filePath,
      mime: template.effectImage.mime,
      name: template.effectImage.name,
      bytes: template.effectImage.bytes
    };
  }

  delete(id) {
    const templateId = String(id || '');
    if (!/^[a-f0-9-]{36}$/i.test(templateId)) throw new Error('提示词模板 ID 无效');
    const templates = this.readAll();
    const template = templates.find((item) => item.id === templateId);
    const next = templates.filter((item) => item.id !== templateId);
    if (next.length === templates.length) return false;
    atomicWriteJson(this.filePath, next);
    if (template?.effectImage?.fileName) {
      fs.rmSync(path.join(this.effectImageDirectory, path.basename(template.effectImage.fileName)), { force: true });
    }
    return true;
  }
}
