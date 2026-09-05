import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './projectStore.js';

const clonePlain = (value) => JSON.parse(JSON.stringify(value));

export class PromptTemplateStore {
  constructor({ dataDirectory, maxTemplates = 200 } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.filePath = path.join(path.resolve(dataDirectory), 'prompts', 'templates.json');
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
    return clonePlain(this.readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  save(draft = {}) {
    const name = String(draft.name || '').trim();
    const text = String(draft.text || '').trim();
    if (!name) throw new Error('提示词名称不能为空');
    if (!text) throw new Error('提示词内容不能为空');
    if (text.length > 4000) throw new Error('提示词内容不能超过 4000 字');
    const templates = this.readAll();
    if (templates.length >= this.maxTemplates) throw new Error(`最多保存 ${this.maxTemplates} 条提示词，请先删除不再使用的模板`);
    const now = new Date().toISOString();
    const template = {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      text,
      createdAt: now,
      updatedAt: now
    };
    atomicWriteJson(this.filePath, [template, ...templates]);
    return clonePlain(template);
  }

  delete(id) {
    const templateId = String(id || '');
    if (!/^[a-f0-9-]{36}$/i.test(templateId)) throw new Error('提示词模板 ID 无效');
    const templates = this.readAll();
    const next = templates.filter((item) => item.id !== templateId);
    if (next.length === templates.length) return false;
    atomicWriteJson(this.filePath, next);
    return true;
  }
}
