import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import velaDataRoutes from './vela-data.js';
import velaGenerationRoutes from './vela-generation.js';
import { ProviderError } from '../providers/openAiCompatibleProvider.js';
import { VelaRuntime } from '../vela/runtime.js';
import { velaJsonErrorHandler } from '../vela/httpErrors.js';
import { computeExternalH3ContractFingerprint } from '../vela/externalJobContract.js';
import { isMaterialsReadOnlyClient, isMaterialsReadRouteAllowed } from '../vela/pairingService.js';
import { AUTO_COMFY_PROFILE_ID } from '../../shared/vela-contracts.js';

const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const successfulImageProvider = {
  listModels: async () => ['gpt-text', 'gpt-image-1.5'],
  generateImages: async () => [{ kind: 'base64', value: VALID_PNG_BYTES.toString('base64') }],
  editImages: async () => [{ kind: 'base64', value: VALID_PNG_BYTES.toString('base64') }]
};

const createServer = async (runtimeOptions = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-routes-'));
  const { pairedClients = [], tokenClients = {}, ...velaOptions } = runtimeOptions;
  const runtime = new VelaRuntime({ dataDirectory: directory, fakeStepDelay: 1, ...velaOptions });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(velaJsonErrorHandler);
  app.locals.velaRuntime = runtime;
  app.locals.pairingService = { listClients: () => pairedClients };
  app.locals.IMAGES_DIR = path.join(directory, 'fake-images');
  fs.mkdirSync(app.locals.IMAGES_DIR, { recursive: true });
  app.use('/api/vela', (req, _res, next) => {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (tokenClients[token]) req.velaClient = tokenClients[token];
    next();
  });
  app.use('/api/vela', (req, res, next) => {
    if (isMaterialsReadOnlyClient(req.velaClient) && !isMaterialsReadRouteAllowed(req.method, req.path)) {
      return res.status(403).json({ error: '当前软件连接仅允许读取已同步素材。' });
    }
    return next();
  });
  app.use('/api', velaGenerationRoutes);
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

test('scoped material clients receive only their inbox and cannot use other Vela routes', async () => {
  const materialClient = {
    id: 'xhs-materials-1',
    name: '小红书素材盘',
    createdAt: new Date(0).toISOString(),
    scopes: ['materials:read']
  };
  const otherClient = {
    id: 'other-materials-1',
    name: '其他素材盘',
    createdAt: new Date(0).toISOString(),
    scopes: ['materials:read']
  };
  const fixture = await createServer({
    pairedClients: [materialClient, otherClient],
    tokenClients: { 'xhs-token': materialClient, 'other-token': otherClient },
    gptProvider: successfulImageProvider
  });
  try {
    const profile = fixture.runtime.createProfile({
      type: 'gpt',
      name: '素材同步测试',
      baseUrl: 'https://relay.test/v1',
      apiKey: 'never-return-this-key',
      models: { prompt: 'gpt-text', image: 'gpt-image-1.5' }
    });
    const imageData = `data:image/png;base64,${Buffer.from('sync-inbox-image').toString('base64')}`;
    const created = await requestJson(`${fixture.baseUrl}/batches`, {
      method: 'POST',
      body: JSON.stringify({
        name: '小红书素材批次',
        prompt: '保持商品主体',
        profileId: profile.id,
        aspectRatio: '3:4',
        resolution: '2K',
        outputCount: 1,
        images: [{ name: 'source.png', data: imageData }]
      })
    });
    const started = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: created.data.items.map((item) => item.id) })
    });
    assert.equal(started.response.status, 202);
    await fixture.runtime.scheduler.waitForIdle();
    const synced = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ targetIds: [materialClient.id] })
    });
    assert.equal(synced.response.status, 200);

    const unauthenticatedManifest = await requestJson(
      `${fixture.baseUrl}/batches/${created.data.id}/sync-manifest?targetId=${materialClient.id}`
    );
    assert.equal(unauthenticatedManifest.response.status, 401);

    const inbox = await requestJson(`${fixture.baseUrl}/sync-inbox`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.equal(inbox.response.status, 200);
    assert.deepEqual(inbox.data, {
      version: 1,
      items: [{ batchId: created.data.id, syncedAt: synced.data.syncedAt }]
    });

    const manifest = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync-manifest`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.data.target, materialClient.id);

    const blockedDeletion = await requestJson(`${fixture.baseUrl}/projects/${created.data.projectId}`, {
      method: 'DELETE'
    });
    assert.equal(blockedDeletion.response.status, 409);
    assert.match(blockedDeletion.data.error, /等待同步软件接收/);

    const forbiddenMedia = await requestJson(
      `${fixture.baseUrl}/projects/${created.data.projectId}/media/not-in-manifest/file`,
      { headers: { Authorization: 'Bearer xhs-token' } }
    );
    assert.equal(forbiddenMedia.response.status, 403);

    const forbiddenWrite = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xhs-token' },
      body: JSON.stringify({ name: '不应创建', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    assert.equal(forbiddenWrite.response.status, 403);
    const forbiddenRead = await requestJson(`${fixture.baseUrl}/profiles`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.equal(forbiddenRead.response.status, 403);
    const forbiddenBatchList = await requestJson(`${fixture.baseUrl}/batches`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.equal(forbiddenBatchList.response.status, 403);
    const forbiddenImageGeneration = await requestJson(`${fixture.baseUrl}/generate-image`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xhs-token' },
      body: JSON.stringify({ prompt: '不应执行', aspectRatio: '1:1' })
    });
    assert.equal(forbiddenImageGeneration.response.status, 403);
    const forbiddenVideoGeneration = await requestJson(`${fixture.baseUrl}/generate-video`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xhs-token' },
      body: JSON.stringify({ prompt: '不应执行', aspectRatio: '16:9' })
    });
    assert.equal(forbiddenVideoGeneration.response.status, 403);

    const wrongClientManifest = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync-manifest`, {
      headers: { Authorization: 'Bearer other-token' }
    });
    assert.equal(wrongClientManifest.response.status, 404);
    const wrongClientAck = await requestJson(`${fixture.baseUrl}/sync-inbox/${created.data.id}/ack`, {
      method: 'POST',
      headers: { Authorization: 'Bearer other-token' },
      body: JSON.stringify({ sourceKeys: [] })
    });
    assert.equal(wrongClientAck.response.status, 404);

    const acknowledged = await requestJson(`${fixture.baseUrl}/sync-inbox/${created.data.id}/ack`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xhs-token' },
      body: JSON.stringify({ sourceKeys: [] })
    });
    assert.equal(acknowledged.response.status, 200);
    assert.equal(acknowledged.data.acknowledged, 0);
    const stillPendingInbox = await requestJson(`${fixture.baseUrl}/sync-inbox`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.deepEqual(stillPendingInbox.data, {
      version: 1,
      items: [{ batchId: created.data.id, syncedAt: synced.data.syncedAt }]
    });
    const sourceKeys = manifest.data.items.flatMap((item) => item.outputs.map(
      (output) => `${manifest.data.batchId}:${item.itemId}:${output.jobId}`
    ));
    const completed = await requestJson(`${fixture.baseUrl}/sync-inbox/${created.data.id}/ack`, {
      method: 'POST',
      headers: { Authorization: 'Bearer xhs-token' },
      body: JSON.stringify({ sourceKeys })
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.data.acknowledged, sourceKeys.length);
    const emptyInbox = await requestJson(`${fixture.baseUrl}/sync-inbox`, {
      headers: { Authorization: 'Bearer xhs-token' }
    });
    assert.deepEqual(emptyInbox.data, { version: 1, items: [] });
    const deletedAfterAcknowledgement = await fetch(`${fixture.baseUrl}/projects/${created.data.projectId}`, {
      method: 'DELETE'
    });
    assert.equal(deletedAfterAcknowledgement.status, 204);
  } finally {
    await fixture.close();
  }
});

test('full-access clients and the local UI still reach generation routes in their real mount order', async () => {
  const fullClient = {
    id: 'legacy-full-client',
    name: '旧版 Storyworks',
    createdAt: new Date(0).toISOString(),
    scopes: ['vela:full']
  };
  const fixture = await createServer({ tokenClients: { 'full-token': fullClient } });
  try {
    const fullClientResult = await requestJson(`${fixture.baseUrl}/generate-image`, {
      method: 'POST',
      headers: { Authorization: 'Bearer full-token' },
      body: JSON.stringify({ prompt: '全权限客户端测试图', aspectRatio: '1:1' })
    });
    assert.equal(fullClientResult.response.status, 200);
    assert.equal(fullClientResult.data.status, 'succeeded');

    const localUiResult = await requestJson(`${fixture.baseUrl}/generate-video`, {
      method: 'POST',
      body: JSON.stringify({ prompt: '本机画布测试视频', aspectRatio: '16:9' })
    });
    assert.equal(localUiResult.response.status, 200);
    assert.equal(localUiResult.data.status, 'succeeded');
  } finally {
    await fixture.close();
  }
});

test('batch workflow API creates one project with independent workflow groups and publishes manifests to selected software', async () => {
  const pairedClient = { id: 'client-route-1', name: '我的商品管理软件', createdAt: new Date(0).toISOString() };
  const fixture = await createServer({
    pairedClients: [pairedClient],
    tokenClients: { 'paired-token': pairedClient },
    gptProvider: successfulImageProvider
  });
  try {
    const profile = fixture.runtime.createProfile({
      type: 'gpt',
      name: '批量图片账户',
      baseUrl: 'https://relay.test/v1',
      apiKey: 'batch-secret-never-return',
      models: { prompt: 'gpt-text', image: 'gpt-image-1.5' }
    });
    const imageData = `data:image/png;base64,${Buffer.from('batch-route-image').toString('base64')}`;
    const created = await requestJson(`${fixture.baseUrl}/batches`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'API 黑裤换色',
        prompt: '把裤子换成黑色',
        profileId: profile.id,
        aspectRatio: '3:4',
        resolution: '2K',
        outputCount: 2,
        benchmarkImage: { name: 'benchmark.png', data: imageData },
        poseVariation: { enabled: true, outputCount: 5, prompt: '只改变人物姿势，其他细节保持不变' },
        images: [{ name: 'a.png', data: imageData }, { name: 'b.png', data: imageData }]
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.items.length, 2);
    assert.equal(created.data.items[0].projectId, created.data.items[1].projectId);
    assert.equal(created.data.projectId, created.data.items[0].projectId);
    const project = await requestJson(`${fixture.baseUrl}/projects/${created.data.projectId}`);
    assert.equal(project.response.status, 200);
    assert.equal(project.data.nodes.length, 8);
    assert.equal(project.data.groups.length, 2);
    assert.equal(new Set(project.data.groups.flatMap((group) => group.nodeIds)).size, 8);
    assert.equal(created.data.poseVariation.outputCount, 5);
    assert.equal(created.data.items.every((item) => item.benchmarkNodeId && item.poseNodeId), true);
    assert.equal(project.data.nodes.filter((node) => node.annotationText === '对标图').length, 2);
    assert.equal(project.data.nodes.filter((node) => node.imageBatchMode === 'pose-variation').length, 2);
    const projects = await requestJson(`${fixture.baseUrl}/projects`);
    assert.equal(projects.data.find((item) => item.id === created.data.projectId).category, 'batch');
    assert.doesNotMatch(JSON.stringify(created.data), /batch-secret-never-return|apiKey/);

    const listed = await requestJson(`${fixture.baseUrl}/batches`);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data[0].id, created.data.id);

    const started = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: created.data.items.map((item) => item.id) })
    });
    assert.equal(started.response.status, 202);
    await fixture.runtime.scheduler.waitForIdle();

    const synced = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync`, {
      method: 'POST', body: JSON.stringify({ targetIds: ['storyworks', pairedClient.id] })
    });
    assert.equal(synced.response.status, 200);
    assert.equal(synced.data.target, 'storyworks');
    assert.equal(synced.data.manifestPath, undefined);
    assert.deepEqual(synced.data.targets.map((target) => target.name), ['编导车间（Storyworks）', pairedClient.name]);

    const manifest = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync-manifest`);
    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.data.items.length, 2);
    assert.equal(manifest.data.format, 'vela-storyworks-batch');
    assert.equal(manifest.data.items.every((item) => item.projectId === created.data.projectId), true);
    assert.equal(manifest.data.items.every((item) => item.groupId), true);
    const legacyAuthenticatedManifest = await requestJson(
      `${fixture.baseUrl}/batches/${created.data.id}/sync-manifest`,
      { headers: { Authorization: 'Bearer paired-token' } }
    );
    assert.equal(legacyAuthenticatedManifest.response.status, 200);
    assert.equal(legacyAuthenticatedManifest.data.target, 'storyworks');
    const clientManifest = await requestJson(
      `${fixture.baseUrl}/batches/${created.data.id}/sync-manifest?targetId=${pairedClient.id}`,
      { headers: { Authorization: 'Bearer paired-token' } }
    );
    assert.equal(clientManifest.response.status, 200);
    assert.equal(clientManifest.data.target, pairedClient.id);
    assert.equal(clientManifest.data.targetApp.name, pairedClient.name);

    const unknownTarget = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/sync`, {
      method: 'POST', body: JSON.stringify({ targetIds: ['missing-client'] })
    });
    assert.equal(unknownTarget.response.status, 400);
  } finally {
    await fixture.close();
  }
});

test('batch start API rejects implicit or malformed selections without creating jobs', async () => {
  const fixture = await createServer({ gptProvider: successfulImageProvider });
  try {
    const profile = fixture.runtime.createProfile({
      type: 'gpt',
      name: '批量请求校验账户',
      baseUrl: 'https://relay.test/v1',
      apiKey: 'validation-secret',
      models: { prompt: 'gpt-text', image: 'gpt-image-1.5' }
    });
    const imageData = `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}`;
    const created = await requestJson(`${fixture.baseUrl}/batches`, {
      method: 'POST',
      body: JSON.stringify({
        name: '批量请求校验',
        prompt: '把裤子换成黑色',
        profileId: profile.id,
        aspectRatio: '3:4',
        resolution: '2K',
        outputCount: 1,
        images: [{ name: 'a.png', data: imageData }]
      })
    });
    assert.equal(created.response.status, 201);

    for (const body of [null, {}, { itemIds: null }, { itemIds: 'bad-client-value' }, { itemIds: [] }, { itemIds: ['missing-item'] }]) {
      const result = await requestJson(`${fixture.baseUrl}/batches/${created.data.id}/start`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      assert.equal(result.response.status, 400);
    }
    assert.equal(fixture.runtime.jobs.listJobs({ limit: 2000 }).length, 0);
    assert.equal(
      fixture.runtime.database.connection.prepare('SELECT COUNT(*) AS count FROM job_groups').get().count,
      0
    );
  } finally {
    await fixture.close();
  }
});

test('project deletion is blocked while a queued job still owns its output directory', async () => {
  const fixture = await createServer();
  try {
    const created = await requestJson(`${fixture.baseUrl}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: '进行中项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
    });
    const db = fixture.runtime.database.connection;
    fixture.runtime.database.transaction(() => {
      const insertGroup = db.prepare(`
        INSERT INTO job_groups(
          id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed,
          total_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'fake', 'offline-profile', 'fixed', 1, 1, ?, ?)
      `);
      const insertJob = db.prepare(`
        INSERT INTO jobs(
          id, group_id, project_id, node_id, provider_type, profile_id, status,
          payload_json, seed, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'fake', 'offline-profile', 'succeeded', '{}', 1, 0, ?, ?)
      `);
      for (let index = 0; index < 2001; index += 1) {
        const groupId = `completed-guard-group-${index}`;
        const nodeId = `completed-guard-node-${index}`;
        const createdAt = new Date(index * 1000).toISOString();
        insertGroup.run(groupId, created.data.id, nodeId, createdAt, createdAt);
        insertJob.run(`completed-guard-job-${index}`, groupId, created.data.id, nodeId, createdAt, createdAt);
      }
    });
    fixture.runtime.jobs.createGroup({
      id: 'guard-group', projectId: created.data.id, nodeId: 'node-1', providerType: 'fake',
      profileId: 'offline-profile', seedMode: 'increment', baseSeed: 1
    }, [{
      id: 'guard-job', groupId: 'guard-group', projectId: created.data.id, nodeId: 'node-1', providerType: 'fake',
      profileId: 'offline-profile', payload: { nodeKind: 'gpt-image', prompt: 'guard' }, seed: 1, workflowVersion: null, priority: 0
    }]);
    assert.equal(fixture.runtime.jobs.listJobs({ limit: 2000 }).some((job) => job.id === 'guard-job'), false);
    assert.equal(fixture.runtime.jobs.countActiveJobsForProject(created.data.id), 1);
    const response = await fetch(`${fixture.baseUrl}/projects/${created.data.id}`, { method: 'DELETE' });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /生成任务/);
    assert.ok(fixture.runtime.projectStore.getProject(created.data.id));
  } finally {
    await fixture.close();
  }
});

test('retired e-commerce workflows are absent from the API', async () => {
  const fixture = await createServer();
  try {
    const listed = await requestJson(`${fixture.baseUrl}/ecommerce-workflows`);
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.data, []);

    const missing = await requestJson(`${fixture.baseUrl}/ecommerce-workflows/wan22-animate-face-outfit/instantiate`, {
      method: 'POST', body: '{}'
    });
    assert.equal(missing.response.status, 404);

    const deleted = await fetch(`${fixture.baseUrl}/ecommerce-workflows/wan22-animate-face-outfit`, { method: 'DELETE' });
    assert.equal(deleted.status, 404);
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
    const shanghaiDate = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const shanghaiDayStart = Date.parse(`${shanghaiDate}T00:00:00+08:00`);
    const createdAt = new Date(shanghaiDayStart + 30_000).toISOString();
    const runningAt = new Date(shanghaiDayStart + 60_000).toISOString();
    const finishedAt = new Date(shanghaiDayStart + 120_000).toISOString();
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

test('capability discovery advertises the durable external-key video contract', async () => {
  const fixture = await createServer();
  try {
    const result = await requestJson(`${fixture.baseUrl}/capabilities`);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.protocolVersion, 2);
    assert.equal(result.data.capabilities.durableVideoProvider.contractVersion, 1);
    assert.equal(result.data.capabilities.durableVideoProvider.createOrReturnMethod, 'PUT');
    assert.equal(result.data.capabilities.durableVideoProvider.lookupMethod, 'GET');
    assert.equal(result.data.capabilities.durableVideoProvider.externalKeyField, 'path.externalKey');
    assert.equal(result.data.capabilities.durableVideoProvider.contractFingerprintField, 'body.contractFingerprint');
    assert.equal(result.data.capabilities.durableVideoProvider.maxJobsPerExternalKey, 1);
    assert.equal(result.data.capabilities.durableVideoProvider.terminalSubmissionUncertain, false);
    assert.equal(result.data.capabilities.batchImageWorkflows.contractVersion, 2);
    assert.equal(result.data.capabilities.batchImageWorkflows.syncTarget, 'storyworks');
    assert.equal(result.data.capabilities.batchImageWorkflows.multipleSyncTargets, true);
    assert.equal(result.data.capabilities.batchImageWorkflows.independentProjectPerImage, false);
    assert.equal(result.data.capabilities.batchImageWorkflows.singleProjectWithIndependentWorkflowGroups, true);
    assert.equal(result.data.capabilities.batchImageWorkflows.inboxPath, '/api/vela/sync-inbox');
    assert.equal(result.data.capabilities.batchImageWorkflows.acknowledgePath, '/api/vela/sync-inbox/{batchId}/ack');
    assert.deepEqual(result.data.capabilities.batchImageWorkflows.supportedClientScopes, ['materials:read']);
  } finally {
    await fixture.close();
  }
});

test('external-key job API atomically creates once, returns the same job, and rejects contract drift', async () => {
  const fixture = await createServer();
  const externalKey = 'storyworks:project-1:unit-7:take-2';
  const url = `${fixture.baseUrl}/jobs/by-external-key/${encodeURIComponent(externalKey)}`;
  const draft = {
    projectId: 'project-1', nodeId: 'unit-7-take-2', profileId: AUTO_COMFY_PROFILE_ID, providerType: 'comfy',
    payload: { nodeKind: 'h3-video', prompt: '候选 take 2', duration: 5, aspectRatio: '16:9', resolution: '720p', videoGenerationMode: 'reference-to-video', referenceUrls: ['/asset/person-v3.png'], requiredReferenceCount: 1 },
    count: 1, seedMode: 'fixed', seed: 17
  };
  try {
    fixture.runtime.createProfile({ type: 'comfy', name: 'H3', baseUrl: 'http://127.0.0.1:18188', transport: 'direct', authType: 'none', workflowVersion: 'minimax-h3-r2v-v1' });
    const contractFingerprint = computeExternalH3ContractFingerprint(draft);
    const requestDraft = { ...draft, contractFingerprint };
    const [first, second] = await Promise.all([
      requestJson(url, { method: 'PUT', body: JSON.stringify(requestDraft) }),
      requestJson(url, { method: 'PUT', body: JSON.stringify(requestDraft) })
    ]);
    assert.deepEqual(new Set([first.response.status, second.response.status]), new Set([200, 202]));
    assert.deepEqual(new Set([first.data.created, second.data.created]), new Set([false, true]));
    assert.equal(first.data.group.id, second.data.group.id);
    assert.equal(first.data.jobs[0].id, second.data.jobs[0].id);
    assert.equal(first.data.group.externalKey, externalKey);
    assert.equal(first.data.group.contractFingerprint, contractFingerprint);

    const exact = await requestJson(url);
    assert.equal(exact.response.status, 200);
    assert.equal(exact.data.group.id, first.data.group.id);
    assert.equal(exact.data.job.id, first.data.jobs[0].id);

    const stored = fixture.runtime.database.connection.prepare('SELECT COUNT(*) AS count FROM jobs WHERE group_id = ?').get(first.data.group.id);
    assert.equal(stored.count, 1);

    const conflict = await requestJson(url, {
      method: 'PUT',
      body: JSON.stringify({ ...draft, prompt: undefined, payload: { ...draft.payload, prompt: 'different take' }, contractFingerprint: computeExternalH3ContractFingerprint({ ...draft, payload: { ...draft.payload, prompt: 'different take' } }) })
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.data.code, 'JOB_CONTRACT_CONFLICT');
    assert.equal(fixture.runtime.database.connection.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 1);

    const oversized = await requestJson(`${fixture.baseUrl}/jobs/by-external-key/storyworks:other`, {
      method: 'PUT',
      body: JSON.stringify({ ...requestDraft, count: 2 })
    });
    assert.equal(oversized.response.status, 400);
  } finally {
    await fixture.close();
  }
});

test('exact external-key lookup finds a new job after more than 2000 older jobs without creating work', async () => {
  const fixture = await createServer();
  const externalKey = 'storyworks:exact:newest-unit:take-1';
  try {
    const db = fixture.runtime.database.connection;
    fixture.runtime.database.transaction(() => {
      const insertGroup = db.prepare(`INSERT INTO job_groups(id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed, total_count, created_at, updated_at) VALUES (?, 'legacy-project', ?, 'fake', 'local', 'fixed', 1, 1, ?, ?)`);
      const insertJob = db.prepare(`INSERT INTO jobs(id, group_id, project_id, node_id, provider_type, profile_id, status, payload_json, seed, priority, created_at, updated_at) VALUES (?, ?, 'legacy-project', ?, 'fake', 'local', 'succeeded', '{}', 1, 0, ?, ?)`);
      for (let index = 0; index < 2001; index += 1) {
        const groupId = `legacy-group-${index}`;
        const nodeId = `legacy-node-${index}`;
        const createdAt = new Date(index * 1000).toISOString();
        insertGroup.run(groupId, nodeId, createdAt, createdAt);
        insertJob.run(`legacy-job-${index}`, groupId, nodeId, createdAt, createdAt);
      }
    });
    const before = db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count;
    const created = fixture.runtime.jobs.createOrGetExternalGroup({
      id: 'exact-group', projectId: 'new-project', nodeId: 'new-node', providerType: 'comfy', profileId: 'resolved-h3', seedMode: 'fixed', baseSeed: 9,
      externalKey, contractFingerprint: 'd'.repeat(64)
    }, [{ id: 'exact-job', payload: { nodeKind: 'h3-video' }, seed: 9 }]);
    assert.equal(created.created, true);

    const exact = await requestJson(`${fixture.baseUrl}/jobs/by-external-key/${encodeURIComponent(externalKey)}`);
    assert.equal(exact.response.status, 200);
    assert.equal(exact.data.group.id, 'exact-group');
    assert.equal(exact.data.job.id, 'exact-job');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, before + 1);

    const missing = await requestJson(`${fixture.baseUrl}/jobs/by-external-key/${encodeURIComponent('storyworks:missing:key')}`);
    assert.equal(missing.response.status, 404);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, before + 1);
  } finally { await fixture.close(); }
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

test('batch prompt analysis uses the selected model slot and prompt templates persist through the API', async () => {
  const calls = [];
  const fixture = await createServer({
    gptProvider: {
      analyzeImagePrompt: async (profile, apiKey, input) => {
        calls.push({ profile, apiKey, input });
        return {
          text: '保留人物与背景，只把裤子替换成对标图款式。',
          source: { provider: 'openai-compatible', profileId: profile.id, model: input.model, modelSlot: input.modelSlot }
        };
      }
    }
  });
  try {
    const profile = fixture.runtime.createProfile({
      type: 'gpt', name: '视觉账户', baseUrl: 'https://relay.test/v1', apiKey: 'sk-analysis-secret',
      models: { prompt: 'gpt-5.6', image: 'gpt-image-2', analysis: 'qwen3-vl-plus' }
    });
    const analyzed = await requestJson(`${fixture.baseUrl}/prompt-analysis`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: profile.id,
        modelSlot: 'analysis',
        requirement: '只换裤子',
        productImages: [{ name: 'product.png', data: `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}` }],
        benchmarkImage: { name: 'benchmark.png', data: `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}` }
      })
    });
    assert.equal(analyzed.response.status, 200);
    assert.equal(calls[0].apiKey, 'sk-analysis-secret');
    assert.equal(calls[0].input.model, 'qwen3-vl-plus');
    assert.equal(calls[0].input.productImages.length, 1);
    assert.doesNotMatch(JSON.stringify(analyzed.data), /sk-analysis-secret/);

    const tooManyImages = await requestJson(`${fixture.baseUrl}/prompt-analysis`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: profile.id,
        modelSlot: 'prompt',
        requirement: '只换裤子',
        productImages: Array.from({ length: 5 }, (_, index) => ({
          name: `product-${index}.png`,
          data: `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}`
        }))
      })
    });
    assert.equal(tooManyImages.response.status, 400);
    assert.equal(calls.length, 1);

    const saved = await requestJson(`${fixture.baseUrl}/prompt-templates`, {
      method: 'POST',
      body: JSON.stringify({
        name: '换裤模板',
        text: analyzed.data.text,
        effectImage: {
          name: '换色效果.png',
          data: `data:image/png;base64,${VALID_PNG_BYTES.toString('base64')}`
        }
      })
    });
    assert.equal(saved.response.status, 201);
    assert.equal(saved.data.effectImage.name, '换色效果.png');
    const effectImage = await fetch(`${fixture.baseUrl}/prompt-templates/${saved.data.id}/effect-image`);
    assert.equal(effectImage.status, 200);
    assert.equal(effectImage.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await effectImage.arrayBuffer()), VALID_PNG_BYTES);
    const listed = await requestJson(`${fixture.baseUrl}/prompt-templates`);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].text, analyzed.data.text);
    const deleted = await fetch(`${fixture.baseUrl}/prompt-templates/${saved.data.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
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
