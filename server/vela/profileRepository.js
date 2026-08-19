import crypto from 'node:crypto';

import { validatePublicProfile } from '../../shared/vela-contracts.js';
import {
  COMFY_CUSTOM_HEADER_ALLOWLIST,
  normalizeComfyBaseUrl,
  normalizeComfyWebsocketUrl
} from '../providers/comfyUiProvider.js';

const DEFAULT_GPT_TIMEOUT_MS = 60_000;
const DEFAULT_COMFY_TIMEOUT_MS = 15_000;
const DEFAULT_AUTODL_IDLE_SHUTDOWN_MINUTES = 5;
const DEFAULT_AUTODL_POWER_ON_TIMEOUT_MS = 10 * 60_000;
const COMFY_AUTH_TYPES = new Set(['none', 'bearer', 'basic', 'custom']);
const DEFAULT_GPT_ENDPOINTS = Object.freeze({
  models: '/models',
  chat: '/chat/completions',
  imageGeneration: '/images/generations',
  imageEdit: '/images/edits',
  videoGeneration: '/videos/generations',
  videoStatus: '/videos/{id}'
});

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

const normalizeEndpointPath = (value, fallback) => {
  const route = cleanText(value || fallback, 240);
  if (!route.startsWith('/') || route.startsWith('//') || /[\r\n]/.test(route)) {
    throw new Error('API 接口路径必须是以单个 / 开头的相对路径');
  }
  return route.replace(/\/{2,}/g, '/');
};

const sanitizeGptConfig = (input = {}) => {
  const models = input.models && typeof input.models === 'object' ? input.models : {};
  const endpoints = input.endpoints && typeof input.endpoints === 'object' ? input.endpoints : {};
  return {
    baseUrl: normalizeOpenAiBaseUrl(input.baseUrl),
    authType: 'bearer',
    provider: cleanText(input.provider || 'OpenAI Compatible', 80),
    models: {
      prompt: typeof models.prompt === 'string' ? models.prompt.trim() : '',
      image: typeof models.image === 'string' ? models.image.trim() : '',
      video: typeof models.video === 'string' ? models.video.trim() : '',
      analysis: typeof models.analysis === 'string' ? models.analysis.trim() : ''
    },
    endpoints: Object.fromEntries(Object.entries(DEFAULT_GPT_ENDPOINTS).map(([key, fallback]) => [
      key,
      normalizeEndpointPath(endpoints[key], fallback)
    ])),
    timeoutMs: clampInteger(input.timeoutMs, DEFAULT_GPT_TIMEOUT_MS, 1_000, 3_600_000),
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
  const transport = input.transport === 'ssh' ? 'ssh' : 'direct';
  if (transport === 'ssh' && (!cleanText(input.sshHost, 255) || !cleanText(input.sshPrivateKeyPath, 1024))) {
    throw new Error('SSH 连接必须填写主机和私钥路径');
  }
  const platform = ['generic', 'autodl', 'runpod'].includes(input.platform) ? input.platform : 'generic';
  const autoPowerEnabled = platform === 'autodl' && Boolean(input.autoPowerEnabled);
  const autodlInstanceUuid = platform === 'autodl' ? cleanText(input.autodlInstanceUuid, 80) : '';
  if (autodlInstanceUuid && !/^pro-[a-z0-9]+$/i.test(autodlInstanceUuid)) {
    throw new Error('AutoDL 容器实例 Pro UUID 无效，应以 pro- 开头');
  }
  if (autoPowerEnabled && !autodlInstanceUuid) {
    throw new Error('启用自动开关机前必须填写 AutoDL 容器实例 Pro UUID');
  }
  return {
    platform,
    baseUrl,
    websocketUrl: normalizeComfyWebsocketUrl(input.websocketUrl, baseUrl),
    transport,
    sshHost: transport === 'ssh' ? cleanText(input.sshHost, 255) : '',
    sshPort: transport === 'ssh' ? clampInteger(input.sshPort, 22, 1, 65535) : 22,
    sshUsername: transport === 'ssh' ? cleanText(input.sshUsername || 'root', 80) : '',
    sshPrivateKeyPath: transport === 'ssh' ? cleanText(input.sshPrivateKeyPath, 1024) : '',
    sshLocalPort: transport === 'ssh' ? clampInteger(input.sshLocalPort, 18188, 1, 65535) : 18188,
    sshRemoteHost: transport === 'ssh' ? cleanText(input.sshRemoteHost || '127.0.0.1', 255) : '',
    sshRemotePort: transport === 'ssh' ? clampInteger(input.sshRemotePort, 8188, 1, 65535) : 8188,
    sshStartScript: transport === 'ssh' && /^\/[a-z0-9._/-]+$/i.test(cleanText(input.sshStartScript, 1024))
      ? cleanText(input.sshStartScript, 1024)
      : '',
    autoPowerEnabled,
    autoPowerProvider: platform === 'autodl' ? 'autodl-pro' : '',
    autodlInstanceUuid,
    idleShutdownMinutes: clampInteger(input.idleShutdownMinutes, DEFAULT_AUTODL_IDLE_SHUTDOWN_MINUTES, 1, 60),
    powerOnTimeoutMs: clampInteger(input.powerOnTimeoutMs, DEFAULT_AUTODL_POWER_ON_TIMEOUT_MS, 60_000, 30 * 60_000),
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

const hasComfyAuthSecretPatch = (patch = {}) => ['token', 'username', 'password', 'customHeaders', 'clearSecret']
  .some((key) => Object.prototype.hasOwnProperty.call(patch, key));

const clearComfyAuthSecret = (secret = {}) => {
  const next = { ...secret };
  delete next.token;
  delete next.username;
  delete next.password;
  delete next.customHeaders;
  return next;
};

const hasSecretValues = (secret) => Boolean(secret && Object.keys(secret).length > 0);

const readCredential = (row, secretProtector) => {
  if (!row.encrypted_secret) return { status: 'missing', secret: null };
  try {
    return { status: 'ready', secret: secretProtector.decrypt(row.encrypted_secret) };
  } catch {
    return { status: 'unreadable', secret: null };
  }
};

const toPublicProfile = (row, secretProtector) => {
  const publicConfig = sanitizePublicConfig(row.type, JSON.parse(row.public_json));
  const credential = readCredential(row, secretProtector);
  return validatePublicProfile({
    id: row.id,
    type: row.type,
    name: row.name,
    ...publicConfig,
    secretConfigured: Boolean(row.encrypted_secret),
    credentialStatus: credential.status,
    ...(row.type === 'comfy' ? {
      autoPowerCredentialConfigured: Boolean(credential.secret?.autodlDeveloperToken),
      autoPowerCredentialStatus: credential.status === 'unreadable'
        ? 'unreadable'
        : credential.secret?.autodlDeveloperToken ? 'ready' : 'missing'
    } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
};

export class ProfileRepository {
  constructor(database, secretProtector) {
    this.database = database;
    this.secretProtector = secretProtector;
  }

  list({ type } = {}) {
    const rows = type
      ? this.database.connection.prepare('SELECT * FROM profiles WHERE type = ? ORDER BY name').all(type)
      : this.database.connection.prepare('SELECT * FROM profiles ORDER BY type, name').all();
    return rows.map((row) => toPublicProfile(row, this.secretProtector));
  }

  get(id) {
    const row = this.database.connection.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    return row ? toPublicProfile(row, this.secretProtector) : null;
  }

  getWithSecret(id) {
    const row = this.database.connection.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) return null;
    const credential = readCredential(row, this.secretProtector);
    return {
      ...toPublicProfile(row, this.secretProtector),
      secret: credential.secret
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
      const authSecret = comfySecretFromDraft({ ...draft, authType: publicConfig.authType }) || {};
      const autodlDeveloperToken = String(draft.autodlDeveloperToken || '').trim();
      secret = {
        ...authSecret,
        ...(autodlDeveloperToken ? { autodlDeveloperToken } : {})
      };
      if (publicConfig.autoPowerEnabled && !autodlDeveloperToken) {
        throw new Error('启用自动开关机前必须填写 AutoDL Developer Token');
      }
      if (publicConfig.authType === 'custom') {
        publicConfig.customHeaderNames = Object.keys(secret?.customHeaders || {});
      }
    }
    const encrypted = hasSecretValues(secret) ? this.secretProtector.encrypt(secret) : null;
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
      ...(row.type === 'gpt' ? {
        models: { ...current.models, ...(patch.models || {}) },
        endpoints: { ...current.endpoints, ...(patch.endpoints || {}) }
      } : {})
    });
    let encrypted = row.encrypted_secret;
    if (row.type === 'gpt') {
      const apiKey = patch.apiKey === undefined ? null : String(patch.apiKey).trim();
      if (patch.apiKey !== undefined && !apiKey) throw new Error('新 API Key 不能为空');
      if (apiKey) encrypted = this.secretProtector.encrypt({ apiKey });
    } else {
      const authChanged = publicConfig.authType !== current.authType;
      const existingCredential = readCredential(row, this.secretProtector);
      const modifiesSecret = hasComfyAuthSecretPatch(patch)
        || Object.prototype.hasOwnProperty.call(patch, 'autodlDeveloperToken')
        || Boolean(patch.clearAutoPowerCredential)
        || authChanged;
      if (existingCredential.status === 'unreadable' && modifiesSecret) {
        throw new Error('当前连接凭据无法解密，请清除旧凭据后重新配置');
      }
      let nextSecret = { ...(existingCredential.secret || {}) };
      if (patch.clearSecret || publicConfig.authType === 'none' || authChanged || hasComfyAuthSecretPatch(patch)) {
        nextSecret = clearComfyAuthSecret(nextSecret);
      }
      if (publicConfig.authType !== 'none' && (authChanged || hasComfyAuthSecretPatch(patch))) {
        nextSecret = {
          ...nextSecret,
          ...(comfySecretFromDraft({ ...patch, authType: publicConfig.authType }) || {})
        };
      }
      if (patch.clearAutoPowerCredential) delete nextSecret.autodlDeveloperToken;
      if (Object.prototype.hasOwnProperty.call(patch, 'autodlDeveloperToken')) {
        const token = String(patch.autodlDeveloperToken || '').trim();
        if (token) nextSecret.autodlDeveloperToken = token;
      }
      if (publicConfig.autoPowerEnabled && !nextSecret.autodlDeveloperToken) {
        throw new Error('启用自动开关机前必须填写 AutoDL Developer Token');
      }
      if (publicConfig.authType === 'custom') {
        publicConfig.customHeaderNames = Object.keys(nextSecret.customHeaders || {});
      }
      encrypted = hasSecretValues(nextSecret) ? this.secretProtector.encrypt(nextSecret) : null;
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
