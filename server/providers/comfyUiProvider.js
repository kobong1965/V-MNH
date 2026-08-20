import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';

import WebSocket from 'ws';

import { redactString } from '../vela/redaction.js';

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export const COMFY_CUSTOM_HEADER_ALLOWLIST = Object.freeze([
  'cf-access-client-id',
  'cf-access-client-secret',
  'runpod-api-key',
  'x-api-key',
  'x-auth-token',
  'x-comfyui-token'
]);

export class ComfyUiError extends Error {
  constructor(message, { code = 'COMFY_CONNECTION_FAILED', status, retryable = false, safeToRetry = false, details } = {}) {
    super(redactString(message));
    this.name = 'ComfyUiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.safeToRetry = safeToRetry;
    this.details = details;
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
    : typeof body?.error?.message === 'string'
      ? body.error.message
      : typeof body?.message === 'string' ? body.message : `ComfyUI HTTP ${response.status}`;
  const details = body?.node_errors ? { nodeErrors: body.node_errors } : undefined;
  if ([401, 403].includes(response.status)) {
    return new ComfyUiError('ComfyUI 鉴权失败，请检查连接凭据', {
      code: 'AUTH_FAILED',
      status: response.status,
      details
    });
  }
  return new ComfyUiError(message, {
    code: TRANSIENT_STATUSES.has(response.status) ? 'COMFY_UNAVAILABLE' : 'COMFY_REJECTED',
    status: response.status,
    retryable: TRANSIENT_STATUSES.has(response.status),
    details
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

const waitForPort = (host, port, process, timeoutMs = 15_000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const attempt = () => {
    if (process.exitCode !== null) {
      reject(new ComfyUiError('AutoDL SSH 隧道提前退出，请检查实例是否运行以及 SSH 配置', {
        code: 'SSH_TUNNEL_FAILED', retryable: true
      }));
      return;
    }
    const socket = net.connect({ host, port });
    socket.setTimeout(750);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    const retry = () => {
      socket.destroy();
      if (Date.now() - started >= timeoutMs) {
        reject(new ComfyUiError('建立 AutoDL SSH 隧道超时，请确认实例仍在运行', {
          code: 'SSH_TUNNEL_TIMEOUT', retryable: true
        }));
      } else setTimeout(attempt, 250);
    };
    socket.once('error', retry);
    socket.once('timeout', retry);
  };
  attempt();
});

class SshTunnelManager {
  constructor({ spawnImpl = spawn } = {}) {
    this.spawn = spawnImpl;
    this.tunnels = new Map();
    this.pending = new Map();
    this.starters = new Set();
  }

  ensure(profile) {
    if (profile.transport !== 'ssh') return;
    const current = this.tunnels.get(profile.id);
    if (current?.process?.exitCode === null) return current.ready;
    const pending = this.pending.get(profile.id);
    if (pending) return pending;
    const operation = this.start(profile).finally(() => this.pending.delete(profile.id));
    this.pending.set(profile.id, operation);
    return operation;
  }

  async start(profile) {
    const port = Math.max(1, Number(profile.sshLocalPort) || new URL(profile.baseUrl).port || 18188);
    const host = String(profile.sshHost || '').trim();
    const user = String(profile.sshUsername || 'root').trim();
    const keyPath = String(profile.sshPrivateKeyPath || '').trim();
    if (!host || !keyPath) {
      throw new ComfyUiError('SSH 连接缺少主机或私钥路径', { code: 'SSH_CONFIG_INVALID' });
    }
    const connectionArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-i', keyPath,
      '-p', String(Math.max(1, Number(profile.sshPort) || 22))
    ];
    const destination = `${user}@${host}`;
    if (profile.sshStartScript) {
      await new Promise((resolve, reject) => {
        const starter = this.spawn('ssh', [
          ...connectionArgs,
          destination,
          'bash', profile.sshStartScript
        ], { windowsHide: true, stdio: 'ignore' });
        this.starters.add(starter);
        const timer = setTimeout(() => {
          starter.kill('SIGKILL');
          reject(new ComfyUiError('等待远端 ComfyUI 启动超时', { code: 'REMOTE_START_TIMEOUT', retryable: true }));
        }, 180_000);
        starter.once('error', (error) => {
          clearTimeout(timer);
          this.starters.delete(starter);
          reject(new ComfyUiError(`无法启动远端 ComfyUI：${error?.message || 'SSH 错误'}`, {
            code: 'REMOTE_START_FAILED', retryable: true
          }));
        });
        starter.once('exit', (code) => {
          clearTimeout(timer);
          this.starters.delete(starter);
          if (code === 0) resolve();
          else reject(new ComfyUiError(`远端 ComfyUI 启动脚本失败（退出码 ${code}）`, {
            code: 'REMOTE_START_FAILED', retryable: true
          }));
        });
      });
    }
    const args = [
      ...connectionArgs,
      '-o', 'ExitOnForwardFailure=yes',
      '-N', '-L', `127.0.0.1:${port}:${profile.sshRemoteHost || '127.0.0.1'}:${Math.max(1, Number(profile.sshRemotePort) || 8188)}`,
      destination
    ];
    const child = this.spawn('ssh', args, { windowsHide: true, stdio: 'ignore' });
    const spawnError = new Promise((_, reject) => child.once('error', (error) => reject(new ComfyUiError(
      `无法启动系统 SSH：${error?.message || '未知错误'}`,
      { code: 'SSH_NOT_AVAILABLE' }
    ))));
    const ready = Promise.race([waitForPort('127.0.0.1', port, child), spawnError]).catch((error) => {
      this.tunnels.delete(profile.id);
      child.kill('SIGKILL');
      throw error;
    });
    child.once('exit', () => {
      if (this.tunnels.get(profile.id)?.process === child) this.tunnels.delete(profile.id);
    });
    this.tunnels.set(profile.id, { process: child, ready });
    return ready;
  }

  close() {
    for (const starter of this.starters) starter.kill('SIGKILL');
    for (const tunnel of this.tunnels.values()) tunnel.process?.kill('SIGKILL');
    this.starters.clear();
    this.tunnels.clear();
    this.pending.clear();
  }
}

export class ComfyUiProvider {
  constructor({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, tunnelManager } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
    this.fetch = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.tunnelManager = tunnelManager || new SshTunnelManager();
  }

  async request(profile, secret, route, { method = 'GET', body, headers = {}, timeoutMs } = {}) {
    await this.tunnelManager.ensure(profile);
    const controller = new AbortController();
    const effectiveTimeout = Math.max(1_000, Number(timeoutMs || profile.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
      const response = await this.fetch(`${profile.baseUrl}${route}`, {
        method,
        body,
        headers: { ...buildComfyAuthHeaders(profile, secret), ...headers },
        signal: controller.signal
      });
      const parsedBody = await parseJson(response);
      if (!response.ok) throw classifyHttpError(response, parsedBody);
      return parsedBody;
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
    await this.tunnelManager.ensure(profile);
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

  async uploadMedia(profile, secret, { data, filename, mime = 'application/octet-stream', subfolder = 'vela' }) {
    const form = new FormData();
    form.append('image', new Blob([data], { type: mime }), filename || `vela-${crypto.randomUUID()}.png`);
    form.append('type', 'input');
    form.append('subfolder', subfolder);
    form.append('overwrite', 'true');
    const uploaded = await this.request(profile, secret, '/upload/image', {
      method: 'POST', body: form, timeoutMs: 300_000
    });
    const name = uploaded?.name || filename;
    if (!name) throw new ComfyUiError('ComfyUI 未返回上传后的素材名称', { code: 'UPLOAD_FAILED' });
    return uploaded?.subfolder ? `${uploaded.subfolder}/${name}` : name;
  }

  uploadImage(profile, secret, input) {
    if (!String(input?.mime || 'image/png').startsWith('image/')) {
      throw new ComfyUiError('图片上传接口只接受图片素材', { code: 'INVALID_INPUT' });
    }
    return this.uploadMedia(profile, secret, input);
  }

  async convertWorkflow(profile, secret, workflow) {
    try {
      const converted = await this.request(profile, secret, '/workflow/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
        timeoutMs: 120_000
      });
      if (!converted || Array.isArray(converted) || typeof converted !== 'object' || Object.keys(converted).length === 0) {
        throw new ComfyUiError('Wan 工作流转换器返回了空结果', { code: 'WORKFLOW_CONVERSION_FAILED' });
      }
      return converted;
    } catch (error) {
      if (error instanceof ComfyUiError && [404, 405].includes(error.status)) {
        throw new ComfyUiError('远端 ComfyUI 未加载 Workflow to API Converter Endpoint，或转换接口不支持 POST；请安装转换插件并重启 ComfyUI', {
          code: 'WORKFLOW_CONVERTER_MISSING',
          status: error.status
        });
      }
      throw error;
    }
  }

  async submitPrompt(profile, secret, prompt, { clientId = `vela-${crypto.randomUUID()}` } = {}) {
    const result = await this.request(profile, secret, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: clientId }),
      timeoutMs: 120_000
    });
    if (!result?.prompt_id) {
      throw new ComfyUiError(result?.error || 'ComfyUI 未返回任务 ID', {
        code: 'PROMPT_REJECTED', details: { nodeErrors: result?.node_errors }
      });
    }
    return { promptId: result.prompt_id, clientId, nodeErrors: result.node_errors || {} };
  }

  getHistory(profile, secret, promptId) {
    return this.request(profile, secret, `/history/${encodeURIComponent(promptId)}`, { timeoutMs: 30_000 });
  }

  async waitForPrompt(profile, secret, promptId, { clientId, onProgress, timeoutMs = DEFAULT_JOB_TIMEOUT_MS } = {}) {
    await this.tunnelManager.ensure(profile);
    let socket;
    let terminalError;
    if (clientId) {
      try {
        const url = new URL(profile.websocketUrl || deriveComfyWebsocketUrl(profile.baseUrl));
        url.searchParams.set('clientId', clientId);
        socket = new this.WebSocketImpl(url.toString(), { headers: buildComfyAuthHeaders(profile, secret) });
        socket.on('error', () => { /* History polling remains authoritative. */ });
        socket.on('message', (raw) => {
          try {
            const event = JSON.parse(String(raw));
            if (event.type === 'progress' && event.data?.prompt_id === promptId) {
              const value = Number(event.data.value);
              const max = Number(event.data.max);
              if (max > 0) onProgress?.(Math.max(0, Math.min(1, value / max)));
            }
            if (event.type === 'execution_error' && event.data?.prompt_id === promptId) {
              terminalError = new ComfyUiError(event.data.exception_message || 'ComfyUI 执行工作流失败', {
                code: 'EXECUTION_FAILED', details: { nodeId: event.data.node_id, nodeType: event.data.node_type }
              });
            }
          } catch { /* Ignore non-JSON preview frames. */ }
        });
      } catch { /* History polling remains authoritative. */ }
    }
    const started = Date.now();
    try {
      while (Date.now() - started < timeoutMs) {
        if (terminalError) throw terminalError;
        const body = await this.getHistory(profile, secret, promptId);
        const history = body?.[promptId];
        if (history) {
          const status = history.status || {};
          if (status.status_str === 'error' || status.completed === false) {
            const message = Array.isArray(status.messages)
              ? status.messages.find((entry) => entry?.[0] === 'execution_error')?.[1]?.exception_message
              : null;
            throw new ComfyUiError(message || 'ComfyUI 执行工作流失败', { code: 'EXECUTION_FAILED' });
          }
          if (status.completed || Object.keys(history.outputs || {}).length > 0) return history;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new ComfyUiError('等待 ComfyUI 任务完成超时；任务 ID 已保留，可继续跟进', {
        code: 'PROMPT_TIMEOUT', retryable: true, safeToRetry: true
      });
    } finally {
      socket?.close?.(1000, 'Vela job finished');
    }
  }

  findVideoOutput(history) {
    for (const output of Object.values(history?.outputs || {})) {
      const values = [
        ...(Array.isArray(output?.images) ? output.images : []),
        ...(Array.isArray(output?.videos) ? output.videos : []),
        ...(Array.isArray(output?.gifs) ? output.gifs : [])
      ];
      const match = values.find((item) => /\.(mp4|webm|mov|m4v)$/i.test(item?.filename || ''));
      if (match) return match;
    }
    throw new ComfyUiError('ComfyUI 任务已完成，但没有找到视频输出', { code: 'OUTPUT_NOT_FOUND', safeToRetry: true });
  }

  createViewUrl(profile, output) {
    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder || '',
      type: output.type || 'output'
    });
    return `${profile.baseUrl}/view?${query}`;
  }

  close() {
    this.tunnelManager.close();
  }
}
