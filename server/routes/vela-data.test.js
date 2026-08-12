import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import velaDataRoutes from './vela-data.js';
import { ProviderError } from '../providers/openAiCompatibleProvider.js';
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
    const renamed = await requestJson(`${fixture.baseUrl}/projects/${created.data.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: '已重命名项目' })
    });
    assert.equal(renamed.response.status, 200);
    assert.equal(renamed.data.name, '已重命名项目');
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
    const deleted = await fetch(`${fixture.baseUrl}/projects/${created.data.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    const missing = await fetch(`${fixture.baseUrl}/projects/${created.data.id}`);
    assert.equal(missing.status, 404);
  } finally {
    await fixture.close();
  }
});

test('workflow API saves a sanitized template and keeps it reusable across projects', async () => {
  const fixture = await createServer();
  try {
    const created = await requestJson(`${fixture.baseUrl}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        name: '商品图工作流',
        nodes: [
          { id: 'source', type: 'Image', kind: 'image-input', x: 0, y: 0, status: 'success', resultUrl: '/old-result.png' },
          { id: 'target', type: 'Image', kind: 'gpt-image', x: 500, y: 0, status: 'error', parentIds: ['source'], prompt: '生成商品图' }
        ],
        groups: []
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.nodes[0].resultUrl, undefined);
    assert.equal(created.data.nodes[0].status, 'idle');
    const listed = await requestJson(`${fixture.baseUrl}/workflows`);
    assert.equal(listed.data[0].nodeCount, 2);
    const loaded = await requestJson(`${fixture.baseUrl}/workflows/${created.data.id}`);
    assert.deepEqual(loaded.data.nodes[1].parentIds, ['source']);
    const deleted = await fetch(`${fixture.baseUrl}/workflows/${created.data.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
  } finally {
    await fixture.close();
  }
});

test('project media API persists canvas uploads inside the current project', async () => {
  const fixture = await createServer();
  try {
    const project = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: '媒体项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    const raw = Buffer.from('tiny-project-image');
    const uploaded = await requestJson(`${fixture.baseUrl}/projects/${project.data.id}/media`, {
      method: 'POST',
      body: JSON.stringify({
        data: `data:image/png;base64,${raw.toString('base64')}`,
        fileName: '桌面图片.png'
      })
    });
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.data.projectId, project.data.id);
    assert.equal(uploaded.data.kind, 'image');
    assert.match(uploaded.data.url, new RegExp(`^/api/vela/projects/${project.data.id}/media/.+/file$`));

    const downloaded = await fetch(new URL(uploaded.data.url, fixture.baseUrl));
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), raw);

    const listed = await requestJson(`${fixture.baseUrl}/projects/${project.data.id}/media`);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].source.fileName, '桌面图片.png');
  } finally {
    await fixture.close();
  }
});

test('workflow API bundles project media and clones it into the target project', async () => {
  const fixture = await createServer();
  try {
    const sourceProject = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Workflow source', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    const targetProject = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Workflow target', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    const raw = Buffer.from('workflow-bundled-image');
    const uploaded = await requestJson(`${fixture.baseUrl}/projects/${sourceProject.data.id}/media`, {
      method: 'POST',
      body: JSON.stringify({
        data: `data:image/png;base64,${raw.toString('base64')}`,
        fileName: 'reference.png'
      })
    });
    const saved = await requestJson(`${fixture.baseUrl}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bundled buyer-show workflow',
        projectId: sourceProject.data.id,
        nodes: [{
          id: 'source', type: 'Image', kind: 'image-input', x: 0, y: 0,
          status: 'success', resultUrl: uploaded.data.url, resultUrls: [uploaded.data.url]
        }],
        groups: []
      })
    });
    assert.equal(saved.response.status, 201);
    assert.equal(saved.data.assets.length, 1);
    assert.equal(saved.data.nodes[0].status, 'success');
    assert.match(saved.data.nodes[0].resultUrl, /^vela-workflow-media:/);
    assert.equal(saved.data.nodes[0].resultUrl, saved.data.nodes[0].resultUrls[0]);
    assert.doesNotMatch(JSON.stringify(saved.data), new RegExp(sourceProject.data.id));

    const list = await requestJson(`${fixture.baseUrl}/workflows`);
    assert.equal(list.data[0].assetCount, 1);
    const instantiated = await requestJson(`${fixture.baseUrl}/workflows/${saved.data.id}/instantiate`, {
      method: 'POST',
      body: JSON.stringify({ projectId: targetProject.data.id })
    });
    assert.equal(instantiated.response.status, 201);
    assert.match(instantiated.data.nodes[0].resultUrl, new RegExp(`^/api/vela/projects/${targetProject.data.id}/media/`));
    assert.equal(instantiated.data.nodes[0].resultUrl, instantiated.data.nodes[0].resultUrls[0]);
    const downloaded = await fetch(new URL(instantiated.data.nodes[0].resultUrl, fixture.baseUrl));
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), raw);
    assert.equal(fixture.runtime.media.list(targetProject.data.id).length, 1);

    const deleted = await fetch(`${fixture.baseUrl}/workflows/${saved.data.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    const retained = await fetch(new URL(instantiated.data.nodes[0].resultUrl, fixture.baseUrl));
    assert.equal(retained.status, 200);
    assert.deepEqual(Buffer.from(await retained.arrayBuffer()), raw);
  } finally {
    await fixture.close();
  }
});

test('project media API rejects unsupported data URLs as user input errors', async () => {
  const fixture = await createServer();
  try {
    const project = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: '媒体校验', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    const uploaded = await requestJson(`${fixture.baseUrl}/projects/${project.data.id}/media`, {
      method: 'POST',
      body: JSON.stringify({ data: 'data:audio/mpeg;base64,AAAA', fileName: 'bad.mp3' })
    });
    assert.equal(uploaded.response.status, 400);
    assert.match(uploaded.data.error, /不支持/);
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

test('profile connection errors expose safe diagnostics and available models', async () => {
  const fixture = await createServer({
    gptProvider: {
      testConnection: async () => {
        throw new ProviderError('模型不存在：missing-image', {
          code: 'MODEL_NOT_FOUND',
          status: 404,
          details: {
            missingModels: ['missing-image'],
            availableModels: ['text-model', 'working-image-model']
          }
        });
      }
    }
  });
  try {
    const created = await requestJson(`${fixture.baseUrl}/profiles`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'gpt', name: 'Relay', baseUrl: 'https://relay.test/v1', apiKey: 'sk-route-secret',
        models: { prompt: 'text-model', image: 'missing-image' }
      })
    });
    const tested = await requestJson(`${fixture.baseUrl}/profiles/${created.data.id}/test`, { method: 'POST' });
    assert.equal(tested.response.status, 422);
    assert.equal(tested.data.code, 'MODEL_NOT_FOUND');
    assert.deepEqual(tested.data.details.missingModels, ['missing-image']);
    assert.deepEqual(tested.data.details.availableModels, ['text-model', 'working-image-model']);
    assert.doesNotMatch(JSON.stringify(tested.data), /sk-route-secret/);
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
