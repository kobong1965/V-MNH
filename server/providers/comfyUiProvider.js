import crypto from 'node:crypto';

import WebSocket from 'ws';

import { redactString } from '../vela/redaction.js';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;

export const COMFY_CUSTOM_HEADER_ALLOWLIST = Object.freeze([
  'cf-access-client-id',
  'cf-access-client-secret',
  'runpod-api-key',
  'x-api-key',
  'x-auth-token',
  'x-comfyui-token'
]);

export class ComfyUiError extends Error {
  constructor(message, { code = 'COMFY_CONNECTION_FAILED', status, retryable = false } = {}) {
    super(redactString(message));
    this.name = 'ComfyUiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const normalizeHttpUrl = (value) => {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('ComfyUI 地址只支持 http 或 https');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
};

export const normalizeComfyBaseUrl = (value) => normalizeHttpUrl(value);

export const deriveComfyWebsocketUrl = (baseUrl) => {
  const url = new URL(normalizeComfyBaseUrl(baseUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`;
  return url.toString();
};

export const normalizeComfyWebsocketUrl = (value, baseUrl) => {
  if (!String(value || '').trim()) return deriveComfyWebsocketUrl(baseUrl);
  const url = new URL(String(value).trim());
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('WebSocket 地址只支持 ws 或 wss');
  }
  url.hash = '';
  return url.toString();
};

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch {
    throw new ComfyUiError('ComfyUI 返回了无法识别的数据', {
      code: 'BAD_RESPONSE',
      status: response.status
    });
  }
};

const classifyHttpError = (response, body) => {
  const message = typeof body?.error === 'string'
    ? body.error
    : typeof body?.message === 'string' ? body.message : `ComfyUI HTTP ${response.status}`;
  if ([401, 403].includes(response.status)) {
    return new ComfyUiError('ComfyUI 鉴权失败，请检查连接凭据', {
      code: 'AUTH_FAILED',
      status: response.status
    });
  }
  return new ComfyUiError(message, {
    code: TRANSIENT_STATUSES.has(response.status) ? 'COMFY_UNAVAILABLE' : 'COMFY_REJECTED',
    status: response.status,
    retryable: TRANSIENT_STATUSES.has(response.status)
  });
};

const normalizeHeaderName = (value) => String(value || '').trim().toLowerCase();

export const buildComfyAuthHeaders = (profile, secret = {}) => {
  const authType = profile.authType || 'none';
  if (authType === 'none') return {};
  if (authType === 'bearer') {
    if (!secret.token) throw new ComfyUiError('Bearer Token 尚未配置', { code: 'AUTH_NOT_CONFIGURED' });
    return { Authorization: `Bearer ${secret.token}` };
  }
  if (authType === 'basic') {
    if (!secret.username || !secret.password) {
      throw new ComfyUiError('Basic Auth 用户名或密码尚未配置', { code: 'AUTH_NOT_CONFIGURED' });
    }
    return { Authorization: `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString('base64')}` };
  }
  if (authType === 'custom') {
    const configured = secret.customHeaders && typeof secret.customHeaders === 'object'
      ? secret.customHeaders
      : {};
    const headers = {};
    for (const [rawName, rawValue] of Object.entries(configured)) {
      const name = normalizeHeaderName(rawName);
      if (!COMFY_CUSTOM_HEADER_ALLOWLIST.includes(name)) {
        throw new ComfyUiError(`不允许使用自定义请求头：${name || '空名称'}`, { code: 'UNSAFE_HEADER' });
      }
      if (!String(rawValue || '').trim()) continue;
      headers[name] = String(rawValue).trim();
    }
    if (!Object.keys(headers).length) {
      throw new ComfyUiError('自定义鉴权请求头尚未配置', { code: 'AUTH_NOT_CONFIGURED' });
    }
    return headers;
  }
  throw new ComfyUiError(`不支持的鉴权方式：${authType}`, { code: 'UNSUPPORTED_AUTH' });
};

const countQueueEntries = (value) => Array.isArray(value) ? value.length : 0;

const normalizeQueue = (body, maxConcurrency) => {
  const running = countQueueEntries(body?.queue_running);
  const pending = countQueueEntries(body?.queue_pending);
  const total = running + pending;
  return {
    running,
    pending,
    total,
    maxConcurrency,
    full: running >= maxConcurrency && pending > 0
  };
};

const normalizeSystem = (body) => {
  const devices = Array.isArray(body?.devices) ? body.devices : [];
  const gpu = devices[0] || null;
  return {
    os: body?.system?.os || null,
    pythonVersion: body?.system?.python_version || null,
    embeddedPython: Boolean(body?.system?.embedded_python),
    gpu: gpu ? {
      name: gpu.name || gpu.type || 'GPU',
      type: gpu.type || null,
      vramTotal: Number(gpu.vram_total) || 0,
      vramFree: Number(gpu.vram_free) || 0,
      torchVramTotal: Number(gpu.torch_vram_total) || 0,
      torchVramFree: Number(gpu.torch_vram_free) || 0
    } : null,
    deviceCount: devices.length
  };
};

const connectionState = (queue) => {
  if (queue.full) return 'queue-full';
  if (queue.running > 0 || queue.pending > 0) return 'online-busy';
  return 'online-idle';
};

export class ComfyUiProvider {
  constructor({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    this.fetch = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
  }

  async request(profile, secret, route) {
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Number(profile.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${profile.baseUrl}${route}`, {
        headers: buildComfyAuthHeaders(profile, secret),
        signal: controller.signal
      });
      const body = await parseJson(response);
      if (!response.ok) throw classifyHttpError(response, body);
      return body;
    } catch (error) {
      if (error instanceof ComfyUiError) throw error;
      if (error?.name === 'AbortError') {
        throw new ComfyUiError('连接 ComfyUI 超时', { code: 'TIMEOUT', retryable: true });
      }
      throw new ComfyUiError(`无法连接 ComfyUI：${error?.message || '网络错误'}`, {
        code: 'NETWORK_ERROR',
        retryable: true
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async checkWebSocket(profile, secret) {
    const url = new URL(profile.websocketUrl || deriveComfyWebsocketUrl(profile.baseUrl));
    if (!url.searchParams.has('clientId')) url.searchParams.set('clientId', `vela-check-${crypto.randomUUID()}`);
    const timeoutMs = Math.max(1_000, Number(profile.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const headers = buildComfyAuthHeaders(profile, secret);
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new this.WebSocketImpl(url.toString(), { headers, handshakeTimeout: timeoutMs });
      const finish = (operation) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation();
      };
      const timer = setTimeout(() => finish(() => {
        socket.terminate?.();
        reject(new ComfyUiError('ComfyUI WebSocket 连接超时', { code: 'WEBSOCKET_TIMEOUT', retryable: true }));
      }), timeoutMs);
      socket.once('open', () => finish(() => {
        socket.close?.(1000, 'Vela connection check');
        resolve({ ok: true, url: profile.websocketUrl || deriveComfyWebsocketUrl(profile.baseUrl) });
      }));
      socket.once('unexpected-response', (_request, response) => finish(() => reject(new ComfyUiError(
        [401, 403].includes(response?.statusCode) ? 'ComfyUI WebSocket 鉴权失败' : `ComfyUI WebSocket HTTP ${response?.statusCode || '错误'}`,
        {
          code: [401, 403].includes(response?.statusCode) ? 'AUTH_FAILED' : 'WEBSOCKET_FAILED',
          status: response?.statusCode
        }
      ))));
      socket.once('error', (error) => finish(() => reject(new ComfyUiError(
        `ComfyUI WebSocket 连接失败：${error?.message || '网络错误'}`,
        { code: /401|403/.test(error?.message || '') ? 'AUTH_FAILED' : 'WEBSOCKET_FAILED', retryable: true }
      ))));
    });
  }

  async getStatus(profile, secret, { checkWebSocket = false } = {}) {
    const [systemBody, queueBody] = await Promise.all([
      this.request(profile, secret, '/system_stats'),
      this.request(profile, secret, '/queue')
    ]);
    const queue = normalizeQueue(queueBody, Math.max(1, Number(profile.maxConcurrency) || 1));
    const result = {
      ok: true,
      type: 'comfy',
      state: connectionState(queue),
      baseUrl: profile.baseUrl,
      websocketUrl: profile.websocketUrl || deriveComfyWebsocketUrl(profile.baseUrl),
      http: { systemStats: true, queue: true },
      system: normalizeSystem(systemBody),
      queue,
      checkedAt: new Date().toISOString()
    };
    if (checkWebSocket) result.websocket = await this.checkWebSocket(profile, secret);
    return result;
  }

  testConnection(profile, secret) {
    return this.getStatus(profile, secret, { checkWebSocket: true });
  }
}
