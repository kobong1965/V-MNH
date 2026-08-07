import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import velaDataRoutes from './vela-data.js';
import { VelaRuntime } from '../vela/runtime.js';

const createServer = async (runtimeOptions = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-routes-'));
  const runtime = new VelaRuntime({ dataDirectory: directory, fakeStepDelay: 1, ...runtimeOptions });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.locals.velaRuntime = runtime;
  app.use('/api', velaDataRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/vela`;
  return {
    baseUrl,
    runtime,
    close: async () => {
      await runtime.scheduler.waitForIdle();
      runtime.close();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  return { response, data: await response.json() };
};

test('project API saves, loads and exports a versioned project', async () => {
  const fixture = await createServer();
  try {
    const created = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: 'API 项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    assert.equal(created.response.status, 201);
    const loaded = await requestJson(`${fixture.baseUrl}/projects/${created.data.id}`);
    assert.equal(loaded.data.name, 'API 项目');
    const exported = await requestJson(`${fixture.baseUrl}/projects/${created.data.id}/export`, {
      method: 'POST', body: JSON.stringify({ includeMedia: false })
    });
    assert.equal(exported.data.format, 'vela-export');
    const packageResponse = await fetch(`${fixture.baseUrl}/projects/${created.data.id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeMedia: false, download: true })
    });
    assert.equal(packageResponse.headers.get('content-type'), 'application/vnd.vela.project');
    assert.ok((await packageResponse.arrayBuffer()).byteLength > 0);
  } finally {
    await fixture.close();
  }
});

test('job API persists a batch and streams it through the fake lifecycle', async () => {
  const fixture = await createServer();
  try {
    const created = await requestJson(`${fixture.baseUrl}/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-1', nodeId: 'node-1', profileId: 'fake-local', providerType: 'fake',
        payload: { prompt: '测试批次' }, count: 4, seedMode: 'increment', seed: 100
      })
    });
    assert.equal(created.response.status, 202);
    assert.equal(created.data.jobs.length, 4);
    await fixture.runtime.scheduler.waitForIdle();
    const jobs = await requestJson(`${fixture.baseUrl}/jobs?groupId=${created.data.group.id}`);
    assert.deepEqual(jobs.data.map((job) => job.status), ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    assert.deepEqual(jobs.data.map((job) => job.seed), [100, 101, 102, 103]);
  } finally {
    await fixture.close();
  }
});

test('job API rejects plaintext secrets before persistence', async () => {
  const fixture = await createServer();
  try {
    const result = await requestJson(`${fixture.baseUrl}/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'p', nodeId: 'n', profileId: 'fake-local', providerType: 'fake',
        payload: { prompt: 'x', apiKey: 'plain-secret' }, count: 1, seedMode: 'fixed', seed: 1
      })
    });
    assert.equal(result.response.status, 400);
    assert.doesNotMatch(JSON.stringify(result.data), /plain-secret/);
  } finally {
    await fixture.close();
  }
});

test('profile API never returns the key and exposes a connection test result', async () => {
  const fixture = await createServer({
    gptProvider: {
      testConnection: async (profile, apiKey) => {
        assert.equal(apiKey, 'sk-route-secret');
        return { ok: true, baseUrl: profile.baseUrl, models: ['prompt-model', 'image-model'], checkedAt: new Date(0).toISOString() };
      }
    }
  });
  try {
    const created = await requestJson(`${fixture.baseUrl}/profiles`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'gpt', name: 'YMAN', baseUrl: 'https://api.yman.cc/V1', apiKey: 'sk-route-secret',
        models: { prompt: '', image: '' }
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.baseUrl, 'https://api.yman.cc/v1');
    assert.doesNotMatch(JSON.stringify(created.data), /sk-route-secret|apiKey/);

    const listed = await requestJson(`${fixture.baseUrl}/profiles?type=gpt`);
    assert.equal(listed.data[0].name, 'YMAN');
    assert.doesNotMatch(JSON.stringify(listed.data), /sk-route-secret|apiKey/);

    const tested = await requestJson(`${fixture.baseUrl}/profiles/${created.data.id}/test`, { method: 'POST' });
    assert.equal(tested.response.status, 200);
    assert.deepEqual(tested.data.models, ['prompt-model', 'image-model']);
  } finally {
    await fixture.close();
  }
});

test('ComfyUI profile API tests HTTP/WebSocket status without exposing cloud credentials', async () => {
  const fixture = await createServer({
    comfyProvider: {
      testConnection: async (profile, secret) => {
        assert.equal(secret.token, 'cloud-bearer-secret');
        return {
          ok: true,
          type: 'comfy',
          state: 'online-idle',
          baseUrl: profile.baseUrl,
          websocketUrl: profile.websocketUrl,
          websocket: { ok: true, url: profile.websocketUrl },
          system: { gpu: { name: 'NVIDIA RTX 5090', vramTotal: 48_000_000_000, vramFree: 40_000_000_000 } },
          queue: { running: 0, pending: 0, total: 0, maxConcurrency: 1, full: false },
          checkedAt: new Date(0).toISOString()
        };
      },
      getStatus: async (profile, secret) => {
        assert.equal(secret.token, 'cloud-bearer-secret');
        return { ok: true, type: 'comfy', state: 'online-idle', baseUrl: profile.baseUrl, queue: { running: 0, pending: 0 } };
      }
    }
  });
  try {
    const created = await requestJson(`${fixture.baseUrl}/profiles`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'comfy', name: 'AutoDL 5090', platform: 'autodl',
        baseUrl: 'https://gpu.example.test/comfy', authType: 'bearer', token: 'cloud-bearer-secret'
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.type, 'comfy');
    assert.doesNotMatch(JSON.stringify(created.data), /cloud-bearer-secret|token/);

    const tested = await requestJson(`${fixture.baseUrl}/profiles/${created.data.id}/test`, { method: 'POST' });
    assert.equal(tested.data.websocket.ok, true);
    assert.equal(tested.data.system.gpu.name, 'NVIDIA RTX 5090');

    const status = await requestJson(`${fixture.baseUrl}/comfy/${created.data.id}/status`);
    assert.equal(status.data.state, 'online-idle');
  } finally {
    await fixture.close();
  }
});
