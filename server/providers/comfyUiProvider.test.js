import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  buildComfyAuthHeaders,
  ComfyUiError,
  ComfyUiProvider,
  deriveComfyWebsocketUrl
} from './comfyUiProvider.js';

const profile = (patch = {}) => ({
  id: 'comfy-main',
  type: 'comfy',
  baseUrl: 'https://gpu.example.test/comfy',
  websocketUrl: 'wss://gpu.example.test/comfy/ws',
  authType: 'bearer',
  timeoutMs: 100,
  maxConcurrency: 1,
  ...patch
});

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

class OpenWebSocket extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    queueMicrotask(() => this.emit('open'));
  }

  close() {}
  terminate() {}
}

test('ComfyUI connection test reads system, queue and authenticated WebSocket status', async () => {
  const requests = [];
  let socket;
  class CapturingWebSocket extends OpenWebSocket {
    constructor(url, options) {
      super(url, options);
      socket = this;
    }
  }
  const provider = new ComfyUiProvider({
    WebSocketImpl: CapturingWebSocket,
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers });
      assert.equal(options.headers.Authorization, 'Bearer comfy-secret');
      if (url.endsWith('/system_stats')) {
        return jsonResponse(200, {
          system: { os: 'linux', python_version: '3.12' },
          devices: [{ name: 'NVIDIA RTX 5090', vram_total: 34_359_738_368, vram_free: 30_000_000_000 }]
        });
      }
      return jsonResponse(200, { queue_running: [[1]], queue_pending: [[2], [3]] });
    }
  });
  const result = await provider.testConnection(profile(), { token: 'comfy-secret' });
  assert.equal(requests.length, 2);
  assert.equal(result.state, 'queue-full');
  assert.equal(result.system.gpu.name, 'NVIDIA RTX 5090');
  assert.equal(result.queue.total, 3);
  assert.equal(result.websocket.ok, true);
  assert.match(socket.url, /clientId=vela-check-/);
  assert.equal(socket.options.headers.Authorization, 'Bearer comfy-secret');
});

test('ComfyUI auth modes are built without permitting unsafe headers', () => {
  assert.deepEqual(buildComfyAuthHeaders(profile({ authType: 'none' }), {}), {});
  assert.match(buildComfyAuthHeaders(profile({ authType: 'basic' }), { username: 'vela', password: 'pass' }).Authorization, /^Basic /);
  assert.deepEqual(
    buildComfyAuthHeaders(profile({ authType: 'custom' }), { customHeaders: { 'X-API-Key': 'value' } }),
    { 'x-api-key': 'value' }
  );
  assert.throws(
    () => buildComfyAuthHeaders(profile({ authType: 'custom' }), { customHeaders: { Host: 'attacker.test' } }),
    (error) => error instanceof ComfyUiError && error.code === 'UNSAFE_HEADER'
  );
});

test('ComfyUI reports authentication failures and derives the standard websocket path', async () => {
  const provider = new ComfyUiProvider({
    fetchImpl: async () => jsonResponse(401, { error: 'no access' })
  });
  await assert.rejects(
    () => provider.getStatus(profile(), { token: 'wrong' }),
    (error) => error instanceof ComfyUiError && error.code === 'AUTH_FAILED'
  );
  assert.equal(deriveComfyWebsocketUrl('http://127.0.0.1:8188'), 'ws://127.0.0.1:8188/ws');
});

test('ComfyUI reports a missing workflow converter for non-JSON 405 responses', async () => {
  const provider = new ComfyUiProvider({
    fetchImpl: async () => new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain' }
    })
  });

  await assert.rejects(
    () => provider.convertWorkflow(profile({ authType: 'none' }), {}, { nodes: [], links: [] }),
    (error) => error instanceof ComfyUiError
      && error.code === 'WORKFLOW_CONVERTER_MISSING'
      && error.status === 405
  );
});

test('ComfyUI finds VideoHelperSuite outputs exposed through the gifs field', () => {
  const provider = new ComfyUiProvider();
  assert.deepEqual(provider.findVideoOutput({
    outputs: {
      36: {
        gifs: [{ filename: 'Wan-Animate_00001-audio.mp4', subfolder: '', type: 'output' }]
      }
    }
  }), {
    filename: 'Wan-Animate_00001-audio.mp4',
    subfolder: '',
    type: 'output'
  });
});
