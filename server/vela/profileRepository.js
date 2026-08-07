import crypto from 'node:crypto';

import { validatePublicProfile } from '../../shared/vela-contracts.js';
import {
  COMFY_CUSTOM_HEADER_ALLOWLIST,
  normalizeComfyBaseUrl,
  normalizeComfyWebsocketUrl
} from '../providers/comfyUiProvider.js';

const DEFAULT_GPT_TIMEOUT_MS = 60_000;
const DEFAULT_COMFY_TIMEOUT_MS = 15_000;
const COMFY_AUTH_TYPES = new Set(['none', 'bearer', 'basic', 'custom']);

export const normalizeOpenAiBaseUrl = (value) => {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 http 或 https');
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (/^\/v1$/i.test(url.pathname)) url.pathname = '/v1';
  return url.toString().replace(/\/$/, '');
};

const clampInteger = (value, fallback, min, max) => Math.min(max, Math.max(min, Number(value) || fallback));
const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);

const sanitizeGptConfig = (input = {}) => {
  const models = input.models && typeof input.models === 'object' ? input.models : {};
  return {
    baseUrl: normalizeOpenAiBaseUrl(input.baseUrl),
    authType: 'bearer',
    models: {
      prompt: typeof models.prompt === 'string' ? models.prompt.trim() : '',
      image: typeof models.image === 'string' ? models.image.trim() : ''
    },
    timeoutMs: clampInteger(input.timeoutMs, DEFAULT_GPT_TIMEOUT_MS, 1_000, 300_000),
    maxConcurrency: clampInteger(input.maxConcurrency, 2, 1, 10)
  };
};

const normalizeTags = (value) => Array.isArray(value)
  ? [...new Set(value.map((tag) => cleanText(tag, 32)).filter(Boolean))].slice(0, 10)
  : [];

const normalizeHeaderNames = (value) => {
  const names = Array.isArray(value) ? value : [];
  const normalized = [...new Set(names.map((name) => String(name || '').trim().toLowerCase()).filter(Boolean))];
  const unsafe = normalized.find((name) => !COMFY_CUSTOM_HEADER_ALLOWLIST.includes(name));
  if (unsafe) throw new Error(`不允许使用自定义请求头：${unsafe}`);
  return normalized;
};

const sanitizeComfyConfig = (input = {}) => {
  const baseUrl = normalizeComfyBaseUrl(input.baseUrl);
  const authType = cleanText(input.authType || 'none', 16).toLowerCase();
  if (!COMFY_AUTH_TYPES.has(authType)) throw new Error(`不支持的 ComfyUI 鉴权方式：${authType}`);
  return {
    platform: ['generic', 'autodl', 'runpod'].includes(input.platform) ? input.platform : 'generic',
    baseUrl,
    websocketUrl: normalizeComfyWebsocketUrl(input.websocketUrl, baseUrl),
    authType,
    customHeaderNames: authType === 'custom' ? normalizeHeaderNames(input.customHeaderNames) : [],
    timeoutMs: clampInteger(input.timeoutMs, DEFAULT_COMFY_TIMEOUT_MS, 1_000, 60_000),
    maxConcurrency: clampInteger(input.maxConcurrency, 1, 1, 16),
    workflowVersion: cleanText(input.workflowVersion, 64),
    tags: normalizeTags(input.tags),
    notes: cleanText(input.notes, 500),
    retentionNote: cleanText(input.retentionNote, 240)
  };
};

const sanitizePublicConfig = (type, input) => type === 'gpt'
  ? sanitizeGptConfig(input)
  : sanitizeComfyConfig(input);

const sanitizeCustomHeaders = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = String(rawName || '').trim().toLowerCase();
    if (!COMFY_CUSTOM_HEADER_ALLOWLIST.includes(name)) {
      throw new Error(`不允许使用自定义请求头：${name || '空名称'}`);
    }
    const headerValue = String(rawValue || '').trim();
    if (headerValue) headers[name] = headerValue;
  }
  return Object.keys(headers).length ? headers : null;
};

const comfySecretFromDraft = (draft = {}) => {
  const authType = draft.authType || 'none';
  if (authType === 'none') return null;
  if (authType === 'bearer') {
    const token = String(draft.token || '').trim();
    return token ? { token } : null;
  }
  if (authType === 'basic') {
    const username = String(draft.username || '').trim();
    const password = String(draft.password || '');
    return username && password ? { username, password } : null;
  }
  if (authType === 'custom') {
    const customHeaders = sanitizeCustomHeaders(draft.customHeaders);
    return customHeaders ? { customHeaders } : null;
  }
  return null;
};

const hasComfySecretPatch = (patch = {}) => ['token', 'username', 'password', 'customHeaders', 'clearSecret']
  .some((key) => Object.prototype.hasOwnProperty.call(patch, key));

const toPublicProfile = (row) => validatePublicProfile({
  id: row.id,
  type: row.type,
  name: row.name,
  ...JSON.parse(row.public_json),
  secretConfigured: Boolean(row.encrypted_secret),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class ProfileRepository {
  constructor(database, secretProtector) {
    this.database = database;
    this.secretProtector = secretProtector;
  }

  list({ type } = {}) {
    const rows = type
      ? this.database.connection.prepare('SELECT * FROM profiles WHERE type = ? ORDER BY name').all(type)
      : this.database.connection.prepare('SELECT * FROM profiles ORDER BY type, name').all();
    return rows.map(toPublicProfile);
  }

  get(id) {
    const row = this.database.connection.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    return row ? toPublicProfile(row) : null;
  }

  getWithSecret(id) {
    const row = this.database.connection.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...toPublicProfile(row),
      secret: row.encrypted_secret ? this.secretProtector.decrypt(row.encrypted_secret) : null
    };
  }

  create(draft) {
    if (!['gpt', 'comfy'].includes(draft?.type)) throw new Error('Profile type 必须是 gpt 或 comfy');
    const name = String(draft.name || '').trim();
    if (!name) throw new Error('账户名称不能为空');
    const now = new Date().toISOString();
    const id = draft.id || crypto.randomUUID();
    const publicConfig = sanitizePublicConfig(draft.type, draft);
    let secret;
    if (draft.type === 'gpt') {
      const apiKey = String(draft.apiKey || '').trim();
      if (!apiKey) throw new Error('API Key 不能为空');
      secret = { apiKey };
    } else {
      secret = comfySecretFromDraft({ ...draft, authType: publicConfig.authType });
      if (publicConfig.authType === 'custom') {
        publicConfig.customHeaderNames = Object.keys(secret?.customHeaders || {});
      }
    }
    const encrypted = secret ? this.secretProtector.encrypt(secret) : null;
    this.database.connection.prepare(`
      INSERT INTO profiles(id, type, name, public_json, encrypted_secret, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, draft.type, name, JSON.stringify(publicConfig), encrypted, now, now);
    return this.get(id);
  }

  update(id, patch) {
    const row = this.database.connection.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) throw new Error(`Profile not found: ${id}`);
    const current = JSON.parse(row.public_json);
    const name = patch.name === undefined ? row.name : String(patch.name).trim();
    if (!name) throw new Error('账户名称不能为空');
    const publicConfig = sanitizePublicConfig(row.type, {
      ...current,
      ...patch,
      ...(row.type === 'gpt' ? { models: { ...current.models, ...(patch.models || {}) } } : {})
    });
    let encrypted = row.encrypted_secret;
    if (row.type === 'gpt') {
      const apiKey = patch.apiKey === undefined ? null : String(patch.apiKey).trim();
      if (patch.apiKey !== undefined && !apiKey) throw new Error('新 API Key 不能为空');
      if (apiKey) encrypted = this.secretProtector.encrypt({ apiKey });
    } else {
      const authChanged = publicConfig.authType !== current.authType;
      if (patch.clearSecret || publicConfig.authType === 'none') {
        encrypted = null;
      } else if (hasComfySecretPatch(patch)) {
        const secret = comfySecretFromDraft({ ...patch, authType: publicConfig.authType });
        encrypted = secret ? this.secretProtector.encrypt(secret) : null;
        if (publicConfig.authType === 'custom') {
          publicConfig.customHeaderNames = Object.keys(secret?.customHeaders || {});
        }
      } else if (authChanged) {
        encrypted = null;
      }
    }
    this.database.connection.prepare(`
      UPDATE profiles SET name = ?, public_json = ?, encrypted_secret = ?, updated_at = ? WHERE id = ?
    `).run(name, JSON.stringify(publicConfig), encrypted, new Date().toISOString(), id);
    return this.get(id);
  }

  delete(id) {
    return this.database.connection.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;
  }
}
