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

test('e-commerce workflow API lists canvases, creates a project and persists deletion', async () => {
  const fixture = await createServer();
  try {
    const listed = await requestJson(`${fixture.baseUrl}/ecommerce-workflows`);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.length, 10);
    assert.ok(listed.data.every((workflow) => workflow.preview.nodes.length === workflow.nodeCount));

    const target = listed.data.find((workflow) => workflow.id === 'dw-pose-redraw');
    const created = await requestJson(`${fixture.baseUrl}/ecommerce-workflows/${target.id}/instantiate`, {
      method: 'POST', body: '{}'
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.name, target.name);
    assert.equal(created.data.nodes.length, target.nodeCount);
    assert.equal(fixture.runtime.projectStore.getProject(created.data.id)?.id, created.data.id);

    const deleted = await fetch(`${fixture.baseUrl}/ecommerce-workflows/${target.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    const afterDelete = await requestJson(`${fixture.baseUrl}/ecommerce-workflows`);
    assert.equal(afterDelete.data.some((workflow) => workflow.id === target.id), false);
    const missing = await requestJson(`${fixture.baseUrl}/ecommerce-workflows/${target.id}/instantiate`, {
      method: 'POST', body: '{}'
    });
    assert.equal(missing.response.status, 404);
  } finally {
    await fixture.close();
  }
});

test('cloud account API returns AutoDL balance and private image repository without exposing its token', async () => {
  const powerProvider = {
    getWalletBalance: async () => ({ assets: 456780, accumulate: 900000, voucher_balance: 12000 }),
    listPrivateImages: async () => ({
      list: [{ image_uuid: 'image-private-1', name: 'H3 生产镜像', status: 'finished', image_size: 2147483648, create_at: '2026-08-19T09:00:00+08:00' }],
      result_total: 1
    })
  };
  const fixture = await createServer({ powerProvider });
  try {
    fixture.runtime.createProfile({
      type: 'comfy',
      name: 'AutoDL H3',
      platform: 'autodl',
      baseUrl: 'http://127.0.0.1:8188',
      authType: 'none',
      autoPowerEnabled: false,
      autodlDeveloperToken: 'cloud-token-never-return'
    });

    const account = await requestJson(`${fixture.baseUrl}/cloud-account`);
    assert.equal(account.response.status, 200);
    assert.equal(account.data.configured, true);
    assert.equal(account.data.balance.availableYuan, 456.78);
    assert.equal(account.data.balance.voucherYuan, 12);
    assert.equal(account.data.repository.total, 1);
    assert.equal(account.data.repository.items[0].name, 'H3 生产镜像');
    assert.doesNotMatch(JSON.stringify(account.data), /cloud-token-never-return/);
  } finally {
    await fixture.close();
  }
});

test('cloud account API has a stable unconfigured state', async () => {
  const fixture = await createServer();
  try {
    const account = await requestJson(`${fixture.baseUrl}/cloud-account`);
    assert.equal(account.response.status, 200);
    assert.equal(account.data.configured, false);
    assert.match(account.data.message, /AutoDL/);
  } finally {
    await fixture.close();
  }
});

test('data dashboard combines AutoDL balance with today H3 usage without exposing credentials', async () => {
  const powerProvider = {
    getWalletBalance: async () => ({ assets: 369500, accumulate: 1305000, voucher_balance: 0 }),
    listPrivateImages: async () => ({ list: [], result_total: 0 })
  };
  const fixture = await createServer({ powerProvider });
  try {
    const profile = fixture.runtime.createProfile({
      type: 'comfy',
      name: 'AutoDL H3 统计账户',
      platform: 'autodl',
      baseUrl: 'http://127.0.0.1:8188',
      authType: 'none',
      autoPowerEnabled: false,
      autodlDeveloperToken: 'dashboard-token-never-return'
    });
    const now = new Date();
    const createdAt = new Date(now.getTime() - 120_000).toISOString();
    const runningAt = new Date(now.getTime() - 90_000).toISOString();
    const finishedAt = new Date(now.getTime() - 30_000).toISOString();
    fixture.runtime.database.connection.prepare(`
      INSERT INTO job_groups(id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed, total_count, created_at, updated_at)
      VALUES ('dashboard-group', 'project', 'node', 'comfy', ?, 'fixed', 1, 1, ?, ?)
    `).run(profile.id, createdAt, finishedAt);
    fixture.runtime.database.connection.prepare(`
      INSERT INTO jobs(id, group_id, project_id, node_id, provider_type, profile_id, status, payload_json, seed, retry_count, priority, created_at, updated_at)
      VALUES ('dashboard-job', 'dashboard-group', 'project', 'node', 'comfy', ?, 'succeeded', ?, 1, 0, 0, ?, ?)
    `).run(profile.id, JSON.stringify({
      nodeKind: 'h3-video', resolution: '1080p', duration: 15, h3Acceleration: 'turbo-8'
    }), createdAt, finishedAt);
    const event = fixture.runtime.database.connection.prepare(`
      INSERT INTO job_events(job_id, event_type, data_json, created_at)
      VALUES ('dashboard-job', 'status-changed', ?, ?)
    `);
    event.run(JSON.stringify({ from: 'queued', to: 'running' }), runningAt);
    event.run(JSON.stringify({ from: 'running', to: 'succeeded' }), finishedAt);

    const dashboard = await requestJson(`${fixture.baseUrl}/data-dashboard`);
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.data.account.balance.availableYuan, 369.5);
    assert.equal(dashboard.data.account.balance.accumulatedYuan, 1305);
    assert.equal(dashboard.data.summary.successfulVideos, 1);
    assert.equal(dashboard.data.summary.gpuSeconds, 60);
    assert.equal(dashboard.data.summary.estimatedCostYuan, 0.13);
    assert.equal(dashboard.data.byResolution.find((item) => item.key === '1080p').successfulVideos, 1);
    assert.equal(dashboard.data.byPreset.find((item) => item.key === 'turbo-8').successfulVideos, 1);
    assert.doesNotMatch(JSON.stringify(dashboard.data), /dashboard-token-never-return|autodlDeveloperToken/);
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

test('AutoDL Pro power API reports status without exposing the developer token', async () => {
  const developerToken = 'route-autodl-developer-token';
  const fixture = await createServer({
    powerProvider: {
      getStatus: async (profile, secret) => {
        assert.equal(profile.autodlInstanceUuid, 'pro-76576c61fdf1');
        assert.equal(secret.autodlDeveloperToken, developerToken);
        return 'stopped';
      }
    }
  });
  try {
    const created = await requestJson(`${fixture.baseUrl}/profiles`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'comfy', name: 'AutoDL Pro', platform: 'autodl',
        baseUrl: 'http://127.0.0.1:18188', authType: 'none',
        autoPowerEnabled: true,
        autodlInstanceUuid: 'pro-76576c61fdf1',
        autodlDeveloperToken: developerToken
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.autoPowerCredentialConfigured, true);
    assert.doesNotMatch(JSON.stringify(created.data), /route-autodl-developer-token|autodlDeveloperToken/);

    const tested = await requestJson(`${fixture.baseUrl}/comfy/${created.data.id}/power/test`, { method: 'POST' });
    assert.equal(tested.response.status, 200);
    assert.equal(tested.data.remoteState, 'stopped');
    assert.doesNotMatch(JSON.stringify(tested.data), /route-autodl-developer-token/);

    const state = await requestJson(`${fixture.baseUrl}/comfy/${created.data.id}/power`);
    assert.equal(state.data.state, 'stopped');
  } finally {
    await fixture.close();
  }
});
