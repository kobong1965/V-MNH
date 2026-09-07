import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ProjectMediaStore } from './mediaStore.js';
import { ProjectStore } from './projectStore.js';
import { BatchWorkflowStore } from './batchWorkflowStore.js';

const PNG_DATA = `data:image/png;base64,${Buffer.from('batch-image').toString('base64')}`;

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-batch-workflow-'));
  const projectStore = new ProjectStore({
    dataDirectory: path.join(root, 'data'),
    projectsDirectory: path.join(root, 'projects')
  });
  const mediaStore = new ProjectMediaStore(projectStore);
  const submissions = [];
  const jobsByGroup = new Map();
  const retryCalls = [];
  const store = new BatchWorkflowStore({
    dataDirectory: path.join(root, 'data'),
    projectStore,
    mediaStore,
    profileRepository: {
      get: (id) => id === 'gpt-clothes' ? {
        id,
        type: 'gpt',
        name: '服装图片账户',
        models: { image: 'gpt-image-1.5' }
      } : null
    },
    createJobGroup: (draft) => {
      submissions.push(draft);
      const group = { id: `group-${submissions.length}` };
      jobsByGroup.set(group.id, Array.from({ length: draft.count }, (_, index) => ({
        id: `${group.id}-job-${index}`,
        groupId: group.id,
        projectId: draft.projectId,
        nodeId: draft.nodeId,
        status: 'queued',
        output: null
      })));
      return { group, jobs: jobsByGroup.get(group.id) };
    },
    listJobs: ({ groupId, limit = 2000 } = {}) => [...jobsByGroup.values()].flat()
      .filter((job) => !groupId || job.groupId === groupId)
      .slice(0, limit),
    findLatestNodeJob: (projectId, nodeId) => [...jobsByGroup.values()].flat().reverse()
      .find((job) => job.projectId === projectId && job.nodeId === nodeId) || null,
    retryFailedGroup: (groupId) => {
      const retried = (jobsByGroup.get(groupId) || [])
        .filter((job) => ['failed', 'submission_uncertain'].includes(job.status));
      retried.forEach((job) => Object.assign(job, { status: 'queued', progress: 0, error: null }));
      retryCalls.push({ groupId, jobIds: retried.map((job) => job.id) });
      return retried;
    }
  });
  return { root, store, projectStore, submissions, jobsByGroup, retryCalls };
};

test('creates one project with one independent workflow group per uploaded image', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '黑裤换色',
      prompt: '把人物穿着的裤子换成纯黑色，其他内容保持不变',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 2,
      images: [
        { name: '模特-A.png', data: PNG_DATA },
        { name: '模特-B.png', data: PNG_DATA }
      ]
    });

    assert.equal(batch.items.length, 2);
    assert.equal(batch.items[0].projectId, batch.items[1].projectId);
    assert.equal(batch.projectId, batch.items[0].projectId);
    assert.equal(fixture.projectStore.listProjects().length, 1);
    const project = fixture.projectStore.getProject(batch.projectId);
    assert.equal(project.name, '黑裤换色');
    assert.equal(project.nodes.length, 4);
    assert.equal(project.groups.length, 2);
    assert.equal(project.settings.batchWorkflow.workflowCount, 2);
    assert.deepEqual(project.settings.batchWorkflow.itemIds, batch.items.map((item) => item.id));
    for (const [index, item] of batch.items.entries()) {
      const inputNode = project.nodes.find((node) => node.id === item.inputNodeId);
      const generationNode = project.nodes.find((node) => node.id === item.generationNodeId);
      const group = project.groups.find((candidate) => candidate.id === item.groupId);
      assert.ok(inputNode.resultUrl.startsWith(`/api/vela/projects/${project.id}/media/`));
      assert.deepEqual(generationNode.parentIds, [inputNode.id]);
      assert.equal(inputNode.groupId, item.groupId);
      assert.equal(generationNode.groupId, item.groupId);
      assert.deepEqual(group.nodeIds, [inputNode.id, generationNode.id]);
      assert.equal(group.label, item.workflowName);
      assert.match(item.workflowName, new RegExp(`工作流 ${String(index + 1).padStart(2, '0')}`));
      assert.equal(generationNode.profileId, 'gpt-clothes');
      assert.equal(generationNode.imageModel, 'gpt-image-1.5');
      assert.equal(generationNode.aspectRatio, '3:4');
      assert.equal(generationNode.resolution, '2K');
      assert.equal(generationNode.outputCount, 2);
      assert.match(generationNode.prompt, /裤子换成纯黑色/);
    }
    assert.equal(project.settings.batchWorkflow.batchId, batch.id);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('creates shared benchmark inputs and a pose-variation suffix for every workflow', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '对标换装',
      prompt: '把商品原图的裤子换到对标图人物身上，其他内容不变',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 1,
      benchmarkImage: { name: '对标模特.png', data: PNG_DATA },
      poseVariation: {
        enabled: true,
        outputCount: 5,
        prompt: '只改变人物姿势，人物、服装、背景和文字保持不变'
      },
      images: [
        { name: '裤子-A.png', data: PNG_DATA },
        { name: '裤子-B.png', data: PNG_DATA }
      ]
    });

    const project = fixture.projectStore.getProject(batch.projectId);
    assert.equal(project.nodes.length, 8);
    assert.equal(project.groups.length, 2);
    assert.equal(batch.benchmark.name, '对标模特.png');
    assert.equal(batch.poseVariation.enabled, true);
    assert.equal(batch.poseVariation.outputCount, 5);
    assert.equal(new Set(batch.items.map((item) => item.benchmarkUrl)).size, 1);

    for (const item of batch.items) {
      const sourceNode = project.nodes.find((node) => node.id === item.inputNodeId);
      const benchmarkNode = project.nodes.find((node) => node.id === item.benchmarkNodeId);
      const generationNode = project.nodes.find((node) => node.id === item.generationNodeId);
      const poseNode = project.nodes.find((node) => node.id === item.poseNodeId);
      const group = project.groups.find((candidate) => candidate.id === item.groupId);
      assert.equal(sourceNode.annotationText, '商品原图');
      assert.equal(benchmarkNode.annotationText, '对标图');
      assert.equal(benchmarkNode.resultUrl, batch.benchmark.url);
      assert.deepEqual(generationNode.parentIds, [sourceNode.id, benchmarkNode.id]);
      assert.equal(poseNode.annotationText, '后缀 · 只换姿势');
      assert.deepEqual(poseNode.parentIds, [generationNode.id]);
      assert.equal(poseNode.imageBatchMode, 'pose-variation');
      assert.equal(poseNode.requiresGeneratedReference, true);
      assert.equal(poseNode.outputCount, 5);
      assert.match(poseNode.prompt, /只改变人物姿势/);
      assert.deepEqual(group.nodeIds, [sourceNode.id, benchmarkNode.id, generationNode.id, poseNode.id]);
    }

    const started = fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    assert.equal(started.started, 1);
    assert.deepEqual(fixture.submissions[0].payload.referenceUrls, [
      batch.items[0].sourceUrl,
      batch.items[0].benchmarkUrl
    ]);
    assert.match(fixture.submissions[0].payload.prompt, /第 1 张是商品原图，第 2 张是对标图/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('validates pose variation settings before creating a project', () => {
  const fixture = createFixture();
  try {
    assert.throws(() => fixture.store.createBatch({
      name: '错误裂变',
      prompt: '生成主图',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      poseVariation: { enabled: true, outputCount: 1, prompt: '只改姿势' },
      images: [{ name: 'source.png', data: PNG_DATA }]
    }), /姿势裂变张数必须是 2-10/);
    assert.equal(fixture.projectStore.listProjects().length, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('starts selected draft workflows once and publishes a Storyworks sync manifest', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '黑裤换色',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [
        { name: 'a.png', data: PNG_DATA },
        { name: 'b.png', data: PNG_DATA }
      ]
    });

    const firstStart = fixture.store.startBatch(batch.id, { itemIds: batch.items.map((item) => item.id) });
    assert.equal(firstStart.started, 2);
    assert.equal(firstStart.skipped, 0);
    assert.equal(fixture.submissions.length, 2);
    assert.equal(fixture.submissions[0].count, 1);
    assert.equal(fixture.submissions[0].providerType, 'gpt');
    assert.equal(fixture.submissions[0].payload.nodeKind, 'gpt-image');
    assert.equal(fixture.submissions[0].payload.referenceUrls.length, 1);

    const secondStart = fixture.store.startBatch(batch.id, { itemIds: batch.items.map((item) => item.id) });
    assert.equal(secondStart.started, 0);
    assert.equal(secondStart.skipped, 2);
    assert.equal(fixture.submissions.length, 2);

    [...fixture.jobsByGroup.values()].flat().forEach((job, index) => Object.assign(job, {
      status: 'succeeded',
      progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/sync-${index}/file` } }
    }));

    const synced = fixture.store.syncBatch(batch.id, { target: 'storyworks' });
    assert.equal(synced.target, 'storyworks');
    assert.equal(synced.items.length, 2);
    assert.match(synced.manifestUrl, new RegExp(`/api/vela/batches/${batch.id}/sync-manifest$`));
    assert.ok(fs.existsSync(synced.manifestPath));
    assert.deepEqual(
      fixture.store.getSyncManifest(batch.id).settings.poseVariation,
      { enabled: false, prompt: '', outputCount: 5 }
    );

    const persisted = fixture.store.getBatch(batch.id);
    assert.equal(persisted.sync.target, 'storyworks');
    assert.ok(persisted.sync.syncedAt);
    assert.equal(persisted.items.every((item) => item.jobGroupId), true);

    const multiTarget = fixture.store.syncBatch(batch.id, { targets: [
      { id: 'storyworks', name: '编导车间（Storyworks）', kind: 'built-in' },
      { id: 'client-123', name: '我的选品软件', kind: 'paired' }
    ] });
    assert.equal(multiTarget.targets.length, 2);
    assert.equal(multiTarget.targets.every((target) => target.status === 'succeeded'), true);
    assert.equal(fixture.store.getSyncManifest(batch.id, 'client-123').targetApp.name, '我的选品软件');
    assert.equal(fixture.store.getBatch(batch.id).lastSync.targets.length, 2);
    assert.throws(() => fixture.store.syncBatch(batch.id, { targets: [{ id: '../escape', name: '非法软件', kind: 'paired' }] }), /无效/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('missing, malformed, empty, or unknown batch selections never start workflows', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '空选择保护',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'a.png', data: PNG_DATA }, { name: 'b.png', data: PNG_DATA }]
    });

    for (const input of [undefined, {}, { itemIds: null }, { itemIds: 'bad-client-value' }, { itemIds: [] }]) {
      assert.throws(
        () => input === undefined ? fixture.store.startBatch(batch.id) : fixture.store.startBatch(batch.id, input),
        (error) => error?.status === 400 && /至少选择一个工作流/.test(error.message)
      );
    }
    assert.throws(
      () => fixture.store.startBatch(batch.id, { itemIds: ['missing-item'] }),
      (error) => error?.status === 400 && /有效工作流/.test(error.message)
    );
    assert.throws(
      () => fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id, 42] }),
      (error) => error?.status === 400 && /工作流 ID/.test(error.message)
    );
    assert.equal(fixture.submissions.length, 0);
    assert.equal(fixture.store.getBatch(batch.id).items.every((item) => item.status === 'draft'), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a partially failed batch item stays failed and retries only its failed jobs', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '失败重试',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 2,
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    const jobs = fixture.jobsByGroup.get('group-1');
    Object.assign(jobs[0], { status: 'succeeded', progress: 1, output: { media: { url: '/output/success.png' } } });
    Object.assign(jobs[1], { status: 'failed', progress: 0.4, error: { code: 'NETWORK_ERROR', message: '连接中断' } });

    assert.equal(fixture.store.getBatch(batch.id).items[0].status, 'failed');
    const retried = fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });

    assert.equal(retried.started, 1);
    assert.equal(retried.skipped, 0);
    assert.equal(fixture.submissions.length, 1);
    assert.deepEqual(fixture.retryCalls, [{ groupId: 'group-1', jobIds: ['group-1-job-1'] }]);
    assert.equal(retried.batch.items[0].status, 'running');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('normalizes a legacy batch pose setting into the complete sync contract', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '旧批次同步',
      prompt: '保持商品主体',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    const indexPath = path.join(fixture.root, 'data', 'batch-workflows', 'index.json');
    const stored = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    delete stored[0].poseVariation;
    fs.writeFileSync(indexPath, `${JSON.stringify(stored)}\n`, 'utf8');

    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    Object.assign(fixture.jobsByGroup.get('group-1')[0], {
      status: 'succeeded',
      progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/legacy-sync/file` } }
    });

    fixture.store.syncBatch(batch.id, { target: 'storyworks' });
    assert.deepEqual(
      fixture.store.getSyncManifest(batch.id).settings.poseVariation,
      { enabled: false, prompt: '', outputCount: 5 }
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('keeps sync inbox acknowledgements isolated per paired client and per output', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '素材盘同步',
      prompt: '保持商品主体',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 2,
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    const jobs = fixture.jobsByGroup.get('group-1');
    jobs.forEach((job, index) => Object.assign(job, {
      status: 'succeeded',
      progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/output-${index}/file` } }
    }));

    const firstTarget = { id: 'xhs-materials-1', name: '小红书素材盘', kind: 'paired' };
    const secondTarget = { id: 'other-materials-1', name: '其他素材盘', kind: 'paired' };
    const synced = fixture.store.syncBatch(batch.id, { targets: [firstTarget, secondTarget] });
    assert.equal(synced.targets.length, 2);
    assert.equal(fixture.store.hasPendingSyncForProject(batch.projectId), true);
    assert.deepEqual(fixture.store.listSyncInbox(firstTarget.id), {
      version: 1,
      items: [{ batchId: batch.id, syncedAt: synced.syncedAt }]
    });
    assert.deepEqual(fixture.store.listSyncInbox(secondTarget.id), {
      version: 1,
      items: [{ batchId: batch.id, syncedAt: synced.syncedAt }]
    });

    const sourceKeys = jobs.map((job) => `${batch.id}:${batch.items[0].id}:${job.id}`);
    assert.throws(
      () => fixture.store.acknowledgeSyncInbox(firstTarget.id, batch.id, ['foreign:source:key']),
      /不属于当前软件/
    );
    assert.deepEqual(fixture.store.acknowledgeSyncInbox(firstTarget.id, batch.id, [sourceKeys[0]]), {
      version: 1,
      batchId: batch.id,
      acknowledged: 1
    });
    assert.equal(fixture.store.listSyncInbox(firstTarget.id).items.length, 1);
    assert.equal(fixture.store.hasPendingSyncForProject(batch.projectId), true);

    assert.deepEqual(fixture.store.acknowledgeSyncInbox(firstTarget.id, batch.id, [sourceKeys[1]]), {
      version: 1,
      batchId: batch.id,
      acknowledged: 2
    });
    assert.deepEqual(fixture.store.listSyncInbox(firstTarget.id), { version: 1, items: [] });
    assert.equal(fs.existsSync(path.join(
      fixture.root,
      'data',
      'batch-workflows',
      'storyworks-outbox',
      'targets',
      firstTarget.id,
      `${batch.id}.json`
    )), false);
    assert.equal(fs.existsSync(path.join(
      fixture.root,
      'data',
      'batch-workflows',
      'storyworks-outbox',
      'archived-targets',
      firstTarget.id,
      `${batch.id}.json`
    )), true);
    assert.equal(fixture.store.listSyncInbox(secondTarget.id).items.length, 1);
    assert.equal(fixture.store.hasPendingSyncForProject(batch.projectId), true);
    assert.equal(fixture.store.isMediaReferencedForTarget(firstTarget.id, batch.projectId, 'output-0'), true);
    assert.equal(fixture.store.isMediaReferencedForTarget(firstTarget.id, batch.projectId, 'not-synced'), false);
    assert.equal(fixture.store.isMediaReferencedForTarget('unrelated-client', batch.projectId, 'output-0'), false);
    assert.deepEqual(fixture.store.cancelOrphanedSyncTargets([firstTarget.id]), {
      cancelled: 1,
      targetCount: 1
    });
    assert.deepEqual(fixture.store.listSyncInbox(secondTarget.id), { version: 1, items: [] });
    const cancelledManifest = fixture.store.getSyncManifest(batch.id, secondTarget.id);
    assert.equal(cancelledManifest.cancellationReason, 'orphaned-connection');
    assert.equal(typeof cancelledManifest.cancelledAt, 'string');
    assert.equal(fixture.store.hasPendingSyncForProject(batch.projectId), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('prefers a new rerun when twenty migrated outputs already fill the sync limit', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '旧结果后重跑',
      prompt: '保持商品主体',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    const [stored] = fixture.store.readIndex();
    stored.items[0].migratedOutputs = Array.from({ length: 20 }, (_, index) => ({
      jobId: `legacy-${index}`,
      url: `/api/vela/projects/${batch.projectId}/media/legacy-${index}/file`
    }));
    fixture.store.writeIndex([stored]);

    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    const rerun = fixture.jobsByGroup.get('group-1')[0];
    Object.assign(rerun, {
      status: 'succeeded',
      progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/new-rerun/file` } }
    });

    const synced = fixture.store.syncBatch(batch.id, {
      targets: [{ id: 'xhs-rerun-limit', name: '小红书素材盘', kind: 'paired' }]
    });
    assert.equal(synced.items[0].outputs.length, 20);
    assert.equal(synced.items[0].outputs[0].jobId, rerun.id);
    assert.equal(synced.items[0].outputs.some((output) => output.jobId === 'legacy-18'), true);
    assert.equal(synced.items[0].outputs.some((output) => output.jobId === 'legacy-19'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('syncs only the latest main rerun plus the latest pose outputs', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '主图与姿势同步',
      prompt: '保持商品主体',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 1,
      poseVariation: { enabled: true, outputCount: 3, prompt: '只改变姿势' },
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    const item = batch.items[0];
    fixture.store.startBatch(batch.id, { itemIds: [item.id] });
    Object.assign(fixture.jobsByGroup.get('group-1')[0], {
      status: 'succeeded', progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/old-main/file` } }
    });

    const mainRerun = fixture.store.createJobGroup({
      projectId: batch.projectId, nodeId: item.generationNodeId, count: 2
    });
    mainRerun.jobs.forEach((job, index) => Object.assign(job, {
      status: 'succeeded', progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/new-main-${index}/file` } }
    }));
    const poseRerun = fixture.store.createJobGroup({
      projectId: batch.projectId, nodeId: item.poseNodeId, count: 3
    });
    poseRerun.jobs.forEach((job, index) => Object.assign(job, {
      status: 'succeeded', progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/new-pose-${index}/file` } }
    }));

    const synced = fixture.store.syncBatch(batch.id, {
      targets: [{ id: 'xhs-materials-latest', name: '小红书素材盘', kind: 'paired' }]
    });
    assert.equal(synced.items[0].outputs.length, 5);
    assert.equal(synced.items[0].outputs.some((output) => output.url.includes('old-main')), false);
    assert.equal(synced.items[0].outputs.filter((output) => output.url.includes('new-main')).length, 2);
    assert.equal(synced.items[0].outputs.filter((output) => output.url.includes('new-pose')).length, 3);
    const reconciledProject = fixture.projectStore.getProject(batch.projectId);
    assert.equal(reconciledProject.nodes.find((node) => node.id === item.generationNodeId).jobGroupId, mainRerun.group.id);
    assert.equal(reconciledProject.nodes.find((node) => node.id === item.poseNodeId).jobGroupId, poseRerun.group.id);
    assert.equal(reconciledProject.nodes.find((node) => node.id === item.generationNodeId).resultUrls.length, 2);
    assert.equal(reconciledProject.nodes.find((node) => node.id === item.poseNodeId).resultUrls.length, 3);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a completed acknowledgement archives the manifest and a later resync becomes pending again', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '重新同步', prompt: '保持商品主体', profileId: 'gpt-clothes',
      aspectRatio: '3:4', resolution: '2K', outputCount: 1,
      images: [{ name: 'source.png', data: PNG_DATA }]
    });
    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    const job = fixture.jobsByGroup.get('group-1')[0];
    Object.assign(job, {
      status: 'succeeded', progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/output/file` } }
    });
    const target = { id: 'xhs-resync', name: '小红书素材盘', kind: 'paired' };
    const first = fixture.store.syncBatch(batch.id, { targets: [target] });
    const sourceKey = `${batch.id}:${batch.items[0].id}:${job.id}`;
    fixture.store.acknowledgeSyncInbox(target.id, batch.id, [sourceKey]);
    assert.deepEqual(fixture.store.listSyncInbox(target.id), { version: 1, items: [] });
    assert.equal(fixture.store.getSyncManifest(batch.id, target.id)?.syncedAt, first.syncedAt);

    const firstMillisecond = Date.now();
    while (Date.now() === firstMillisecond) { /* ensure a distinct sync revision */ }
    const second = fixture.store.syncBatch(batch.id, { targets: [target] });
    assert.notEqual(second.syncedAt, first.syncedAt);
    assert.deepEqual(fixture.store.listSyncInbox(target.id), {
      version: 1,
      items: [{ batchId: batch.id, syncedAt: second.syncedAt }]
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('writes completed batch outputs back to the canvas generation nodes', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '结果回写',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '3:4',
      resolution: '2K',
      outputCount: 2,
      images: [{ name: 'result.png', data: PNG_DATA }]
    });
    fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    const jobs = fixture.jobsByGroup.get('group-1');
    jobs.forEach((job, index) => Object.assign(job, {
      status: 'succeeded',
      progress: 1,
      output: { media: { url: `/api/vela/projects/${batch.projectId}/media/output-${index}/file` } }
    }));

    const completed = fixture.store.getBatch(batch.id);
    assert.equal(completed.items[0].status, 'succeeded');
    assert.equal(completed.items[0].outputs.length, 2);
    const project = fixture.store.reconcileProject(batch.projectId);
    const generationNode = project.nodes.find((node) => node.id === batch.items[0].generationNodeId);
    assert.equal(generationNode.status, 'success');
    assert.equal(generationNode.generationProgress, 100);
    assert.equal(generationNode.resultUrl, `/api/vela/projects/${batch.projectId}/media/output-0/file`);
    assert.deepEqual(generationNode.resultUrls, [
      `/api/vela/projects/${batch.projectId}/media/output-0/file`,
      `/api/vela/projects/${batch.projectId}/media/output-1/file`
    ]);
    fixture.projectStore.saveProject({
      ...project,
      nodes: project.nodes.map((node) => node.id === generationNode.id
        ? { ...node, resultUrl: `/api/vela/projects/${batch.projectId}/media/output-1/file` }
        : node)
    });
    const reopened = fixture.store.reconcileProject(batch.projectId);
    assert.equal(
      reopened.nodes.find((node) => node.id === generationNode.id).resultUrl,
      `/api/vela/projects/${batch.projectId}/media/output-1/file`
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('classifies current and legacy indexed projects as batch projects', () => {
  const fixture = createFixture();
  try {
    const ordinary = fixture.projectStore.saveProject({
      name: '普通项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 }
    });
    const batch = fixture.store.createBatch({
      name: '批量项目',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'batch.png', data: PNG_DATA }]
    });
    const summaries = fixture.store.decorateProjectSummaries(fixture.projectStore.listProjects());
    assert.equal(summaries.find((project) => project.id === ordinary.id).category, 'project');
    assert.equal(summaries.find((project) => project.id === batch.projectId).category, 'batch');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('migrates a legacy multi-project batch into one visible project with independent groups', () => {
  const fixture = createFixture();
  try {
    const legacyItems = ['a.png', 'b.png'].map((sourceName, index) => {
      const legacy = fixture.projectStore.saveProject({
        name: `旧项目-${index + 1}`,
        nodes: [],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      });
      const legacyMedia = new ProjectMediaStore(fixture.projectStore);
      const media = legacyMedia.saveUploadedMedia(legacy.id, {
        dataUrl: PNG_DATA,
        fileName: sourceName
      });
      const benchmarkMedia = legacyMedia.saveUploadedMedia(legacy.id, {
        dataUrl: PNG_DATA,
        fileName: `benchmark-${index}.png`
      });
      const mainOutput = legacyMedia.saveUploadedMedia(legacy.id, {
        dataUrl: PNG_DATA,
        fileName: `main-output-${index}.png`
      });
      const poseOutput = legacyMedia.saveUploadedMedia(legacy.id, {
        dataUrl: PNG_DATA,
        fileName: `pose-output-${index}.png`
      });
      const inputNodeId = `legacy-input-${index}`;
      const benchmarkNodeId = `legacy-benchmark-${index}`;
      const generationNodeId = `legacy-output-${index}`;
      const poseNodeId = `legacy-pose-${index}`;
      fixture.projectStore.saveProject({
        ...legacy,
        nodes: [{
          id: inputNodeId, type: 'Image', kind: 'image-input', title: sourceName,
          x: 10, y: 10, prompt: sourceName, status: 'success', resultUrl: media.url,
          model: 'Upload', aspectRatio: '1:1', resolution: 'Auto', outputCount: 1, parentIds: []
        }, {
          id: benchmarkNodeId, type: 'Image', kind: 'image-input', title: '对标图',
          x: 10, y: 300, prompt: '对标图', status: 'success', resultUrl: benchmarkMedia.url,
          model: 'Upload', aspectRatio: '1:1', resolution: 'Auto', outputCount: 1, parentIds: []
        }, {
          id: generationNodeId, type: 'Image', kind: 'gpt-image', title: '图生图',
          x: 200, y: 10, prompt: '换色', status: 'success', profileId: 'gpt-clothes',
          model: 'gpt-image-1.5', imageModel: 'gpt-image-1.5', aspectRatio: '1:1',
          resolution: '2K', outputCount: 1, parentIds: [inputNodeId, benchmarkNodeId],
          resultUrl: mainOutput.url, resultUrls: [mainOutput.url]
        }, {
          id: poseNodeId, type: 'Image', kind: 'gpt-image', title: '姿势裂变',
          x: 400, y: 10, prompt: '只改变姿势', status: 'success', profileId: 'gpt-clothes',
          model: 'gpt-image-1.5', imageModel: 'gpt-image-1.5', aspectRatio: '1:1',
          resolution: '2K', outputCount: 1, parentIds: [generationNodeId],
          resultUrl: poseOutput.url, resultUrls: [poseOutput.url]
        }],
        groups: []
      });
      return {
        id: `legacy-item-${index}`,
        index,
        sourceName,
        projectId: legacy.id,
        projectName: legacy.name,
        inputNodeId,
        benchmarkNodeId,
        generationNodeId,
        poseNodeId,
        sourceUrl: media.url,
        benchmarkUrl: benchmarkMedia.url,
        jobGroupId: null
      };
    });
    fixture.store.writeIndex([{
      id: 'legacy-batch',
      name: '旧批量换色',
      prompt: '换色',
      profileId: 'gpt-clothes',
      profileName: '服装图片账户',
      imageModel: 'gpt-image-1.5',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sync: null,
      items: legacyItems
    }]);

    const [batch] = fixture.store.listBatches();
    assert.equal(new Set(batch.items.map((item) => item.projectId)).size, 1);
    assert.equal(batch.projectId, batch.items[0].projectId);
    assert.deepEqual(batch.legacyProjectIds.sort(), legacyItems.map((item) => item.projectId).sort());
    const consolidated = fixture.projectStore.getProject(batch.projectId);
    assert.equal(consolidated.nodes.length, 8);
    assert.equal(consolidated.groups.length, 2);
    assert.equal(consolidated.groups.every((group) => group.nodeIds.length === 4), true);
    assert.equal(batch.items.every((item) => item.sourceUrl.includes(`/projects/${batch.projectId}/media/`)), true);
    assert.equal(batch.items.every((item) => item.benchmarkUrl.includes(`/projects/${batch.projectId}/media/`)), true);
    assert.equal(batch.items.every((item) => item.migratedOutputs.length === 2), true);
    assert.equal(batch.items.every((item) => item.jobGroupId === null), true);
    assert.equal(consolidated.nodes.filter((node) => node.id.startsWith('batch-pose-')).every((node) => (
      node.parentIds.length === 1 && node.parentIds[0].startsWith('batch-output-')
    )), true);

    const visible = fixture.store.decorateProjectSummaries(fixture.projectStore.listProjects());
    assert.equal(visible.filter((project) => project.category === 'batch').length, 1);
    assert.equal(visible.some((project) => batch.legacyProjectIds.includes(project.id)), false);
    assert.equal(fixture.projectStore.listProjects().length, 3);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('recovers an already persisted node job before submitting a batch item again', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '断点恢复',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'recover.png', data: PNG_DATA }]
    });
    fixture.jobsByGroup.set('recovered-group', [{
      id: 'recovered-job',
      groupId: 'recovered-group',
      projectId: batch.items[0].projectId,
      nodeId: batch.items[0].generationNodeId,
      status: 'queued',
      output: null
    }]);

    const result = fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    assert.equal(result.started, 0);
    assert.equal(result.skipped, 1);
    assert.equal(fixture.submissions.length, 0);
    assert.equal(fixture.store.getBatch(batch.id).items[0].jobGroupId, 'recovered-group');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('recovers and retries a failed persisted node job in the same start request', () => {
  const fixture = createFixture();
  try {
    const batch = fixture.store.createBatch({
      name: '失败断点恢复',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'recover-failed.png', data: PNG_DATA }]
    });
    fixture.jobsByGroup.set('recovered-failed-group', [{
      id: 'recovered-failed-job',
      groupId: 'recovered-failed-group',
      projectId: batch.items[0].projectId,
      nodeId: batch.items[0].generationNodeId,
      status: 'submission_uncertain',
      output: null
    }]);

    const result = fixture.store.startBatch(batch.id, { itemIds: [batch.items[0].id] });
    assert.equal(result.started, 1);
    assert.equal(result.skipped, 0);
    assert.equal(fixture.submissions.length, 0);
    assert.deepEqual(fixture.retryCalls, [{
      groupId: 'recovered-failed-group',
      jobIds: ['recovered-failed-job']
    }]);
    assert.equal(fixture.store.getBatch(batch.id).items[0].jobGroupId, 'recovered-failed-group');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects unsupported image data before creating any project', () => {
  const fixture = createFixture();
  try {
    assert.throws(() => fixture.store.createBatch({
      name: '无效图片',
      prompt: '把裤子换成黑色',
      profileId: 'gpt-clothes',
      aspectRatio: '1:1',
      resolution: '2K',
      outputCount: 1,
      images: [{ name: 'vector.svg', data: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` }]
    }), /格式不受支持/);
    assert.equal(fixture.projectStore.listProjects().length, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
