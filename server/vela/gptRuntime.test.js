import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VelaRuntime } from './runtime.js';
import { SecretProtector } from './secretProtector.js';

test('GPT image job downloads into the project and prompt optimizer preserves source metadata', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-runtime-'));
  const imageBytes = Buffer.from('fixture-image-payload');
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 9) }),
    gptProvider: {
      listModels: async () => ['prompt-model', 'image-model'],
      generateImages: async (_profile, apiKey, input) => {
        assert.equal(apiKey, 'sk-runtime-secret');
        assert.equal(input.prompt, '商品主图');
        assert.equal(input.size, undefined);
        assert.equal(input.quality, undefined);
        assert.ok(input.idempotencyKey);
        return [{ kind: 'base64', value: imageBytes.toString('base64') }];
      },
      optimizePrompt: async (profile, apiKey, input) => ({
        text: `${input.prompt}，电影光线`,
        source: { provider: 'openai-compatible', profileId: profile.id, model: profile.models.prompt, keySeen: apiKey === 'sk-runtime-secret' }
      })
    }
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'P3 项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const profile = runtime.createProfile({
      type: 'gpt', name: 'YMAN', baseUrl: 'https://api.yman.cc/v1', apiKey: 'sk-runtime-secret',
      models: { prompt: 'prompt-model', image: 'image-model' }
    });
    const imageGroup = runtime.createJobGroup({
      projectId: project.id, nodeId: 'image-node', profileId: profile.id, providerType: 'gpt',
      payload: { nodeKind: 'gpt-image', prompt: '商品主图', size: '704x1024', quality: 'low' }, count: 1, seedMode: 'fixed', seed: 1
    });
    await runtime.scheduler.waitForIdle();
    const imageJob = runtime.jobs.getJob(imageGroup.jobs[0].id);
    assert.equal(imageJob.status, 'succeeded');
    assert.doesNotMatch(JSON.stringify(imageJob), /sk-runtime-secret|apiKey/);
    const resolved = runtime.media.resolveFile(project.id, imageJob.output.media.id);
    assert.ok(resolved && fs.existsSync(resolved.filePath));
    assert.equal(imageJob.output.media.sha256, crypto.createHash('sha256').update(imageBytes).digest('hex'));

    const optimizeGroup = runtime.createJobGroup({
      projectId: project.id, nodeId: 'prompt-node', profileId: profile.id, providerType: 'gpt',
      payload: { nodeKind: 'gpt-prompt-optimizer', prompt: '商品旋转' }, count: 1, seedMode: 'fixed', seed: 2
    });
    await runtime.scheduler.waitForIdle();
    const promptJob = runtime.jobs.getJob(optimizeGroup.jobs[0].id);
    assert.equal(promptJob.status, 'succeeded');
    assert.equal(promptJob.output.text, '商品旋转，电影光线');
    assert.equal(promptJob.output.source.model, 'prompt-model');
    assert.doesNotMatch(JSON.stringify(promptJob), /sk-runtime-secret|apiKey/);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GPT job checks the configured model before submitting a billable image request', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-preflight-'));
  let generationCalls = 0;
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 7) }),
    gptProvider: {
      listModels: async () => ['text-only-model'],
      generateImages: async () => {
        generationCalls += 1;
        return [];
      }
    }
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Preflight', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const profile = runtime.createProfile({
      type: 'gpt', name: 'Text only relay', baseUrl: 'https://relay.test/v1', apiKey: 'sk-runtime-secret',
      models: { prompt: 'text-only-model', image: 'missing-image-model' }
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'image-node', profileId: profile.id, providerType: 'gpt',
      payload: { nodeKind: 'gpt-image', prompt: '商品主图' }, count: 1, seedMode: 'fixed', seed: 1
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'MODEL_NOT_FOUND');
    assert.match(job.error.message, /missing-image-model/);
    assert.equal(generationCalls, 0);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unreadable saved credentials fail the job with a repair instruction', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-credential-'));
  const projectsDirectory = path.join(directory, 'projects');
  const firstRuntime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory,
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 1) })
  });
  const project = firstRuntime.projectStore.saveProject({ name: 'Credential', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
  const profile = firstRuntime.createProfile({
    type: 'gpt', name: 'Relay', baseUrl: 'https://relay.test/v1', apiKey: 'sk-runtime-secret',
    models: { prompt: 'text-model', image: 'image-model' }
  });
  firstRuntime.close();

  let modelCalls = 0;
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory,
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 2) }),
    gptProvider: { listModels: async () => { modelCalls += 1; return []; } }
  });
  try {
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'image-node', profileId: profile.id, providerType: 'gpt',
      payload: { nodeKind: 'gpt-image', prompt: '商品主图' }, count: 1, seedMode: 'fixed', seed: 1
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'CREDENTIAL_UNREADABLE');
    assert.match(job.error.message, /重新输入 API Key/);
    assert.equal(modelCalls, 0);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GPT video job persists the remote task id, progress and downloaded video', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-video-runtime-'));
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 4) }),
    mediaFetch: async (url, options) => {
      assert.equal(url, 'https://boundles.cc/v1/videos/boundless-task-1/content');
      assert.equal(options.headers.Authorization, 'Bearer sk-video-secret');
      return new Response(Buffer.from('generated-video'), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' }
      });
    },
    gptProvider: {
      listModels: async () => ['seedance-2.5-720p'],
      generateVideo: async (_profile, apiKey, input) => {
        assert.equal(apiKey, 'sk-video-secret');
        assert.equal(input.seconds, 10);
        assert.equal(input.ratio, '9:16');
        assert.equal(input.resolution, '720p');
        assert.equal(input.imageUrls.length, 1);
        assert.match(input.imageUrls[0], /^data:image\/png;base64,/);
        await input.onSubmitted('boundless-task-1');
        await input.onProgress(0.6);
        return { kind: 'url', value: 'https://boundles.cc/v1/videos/boundless-task-1/content', taskId: 'boundless-task-1' };
      }
    }
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Video', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const reference = runtime.media.saveUploadedMedia(project.id, {
      dataUrl: `data:image/png;base64,${Buffer.from('reference-image').toString('base64')}`,
      fileName: 'reference.png'
    });
    const profile = runtime.createProfile({
      type: 'gpt', name: 'Boundless', provider: 'Boundless', baseUrl: 'https://boundles.cc/v1', apiKey: 'sk-video-secret',
      models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
      endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'video-node', profileId: profile.id, providerType: 'gpt',
      payload: {
        nodeKind: 'gpt-video', prompt: '模特转身', duration: 10, aspectRatio: '9:16', resolution: '720p',
        referenceUrls: [reference.url]
      },
      count: 1, seedMode: 'fixed', seed: 1
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.promptId, 'boundless-task-1');
    assert.equal(job.progress, 1);
    assert.equal(job.output.media.kind, 'video');
    assert.equal(job.output.media.source.taskId, 'boundless-task-1');
    assert.ok(fs.existsSync(runtime.media.resolveFile(project.id, job.output.media.id).filePath));
    assert.doesNotMatch(JSON.stringify(job), /sk-video-secret|apiKey/);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('retrying a video job with a remote task id resumes polling without another paid submission', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-video-resume-'));
  let submitCalls = 0;
  let pollCalls = 0;
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 5) }),
    mediaFetch: async () => new Response(Buffer.from('recovered-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    }),
    gptProvider: {
      listModels: async () => ['seedance-2.5-720p'],
      generateVideo: async (_profile, _apiKey, input) => {
        submitCalls += 1;
        await input.onSubmitted('existing-boundless-task');
        throw new Error('temporary unknown status');
      },
      pollVideoTask: async (_profile, _apiKey, taskId, { onProgress }) => {
        pollCalls += 1;
        assert.equal(taskId, 'existing-boundless-task');
        await onProgress(1);
        return { kind: 'url', value: 'https://cdn.example.test/recovered.mp4', taskId };
      }
    }
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Resume video', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const profile = runtime.createProfile({
      type: 'gpt', name: 'Boundless', provider: 'Boundless', baseUrl: 'https://boundles.cc/v1', apiKey: 'sk-video-secret',
      models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
      endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'video-node', profileId: profile.id, providerType: 'gpt',
      payload: { nodeKind: 'gpt-video', prompt: '恢复原任务', duration: 5, aspectRatio: '16:9', resolution: '720p', referenceUrls: [] },
      count: 1, seedMode: 'fixed', seed: 1
    });
    await runtime.scheduler.waitForIdle();
    const failed = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.promptId, 'existing-boundless-task');

    runtime.retryJob(failed.id);
    await runtime.scheduler.waitForIdle();
    const recovered = runtime.jobs.getJob(failed.id);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.promptId, 'existing-boundless-task');
    assert.equal(recovered.output.media.source.taskId, 'existing-boundless-task');
    assert.equal(submitCalls, 1);
    assert.equal(pollCalls, 1);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('restart during an authenticated video download resumes and completes the original task', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-gpt-video-restart-'));
  const projectsDirectory = path.join(directory, 'projects');
  const secretProtector = new SecretProtector({ key: Buffer.alloc(32, 6) });
  let originalTaskId;
  let profileId;
  let projectId;
  let jobId;
  let firstRuntime = new VelaRuntime({ dataDirectory: directory, projectsDirectory, secretProtector });
  try {
    const project = firstRuntime.projectStore.saveProject({ name: 'Restart video', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    projectId = project.id;
    const profile = firstRuntime.createProfile({
      type: 'gpt', name: 'Boundless', provider: 'Boundless', baseUrl: 'https://boundles.cc/v1', apiKey: 'sk-restart-secret',
      models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
      endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
    });
    profileId = profile.id;
    originalTaskId = 'existing-task-after-restart';
    jobId = crypto.randomUUID();
    firstRuntime.jobs.createGroup({
      id: crypto.randomUUID(), projectId, nodeId: 'video-node', providerType: 'gpt', profileId, seedMode: 'fixed', baseSeed: 1
    }, [{
      id: jobId,
      payload: { nodeKind: 'gpt-video', prompt: '重启续传', duration: 5, aspectRatio: '16:9', resolution: '720p', referenceUrls: [] },
      seed: 1
    }]);
    firstRuntime.jobs.transition(jobId, 'submitting');
    firstRuntime.jobs.transition(jobId, 'running', { promptId: originalTaskId, progress: 0.8 });
    firstRuntime.jobs.transition(jobId, 'downloading', { progress: 0.9 });
    firstRuntime.close();
    firstRuntime = null;

    let submitCalls = 0;
    let pollCalls = 0;
    const restartedRuntime = new VelaRuntime({
      dataDirectory: directory,
      projectsDirectory,
      secretProtector,
      mediaFetch: async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer sk-restart-secret');
        return new Response(Buffer.from('restart-recovered-video'), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        });
      },
      gptProvider: {
        listModels: async () => ['seedance-2.5-720p'],
        generateVideo: async () => { submitCalls += 1; throw new Error('must not submit'); },
        pollVideoTask: async (_profile, _apiKey, taskId, { onProgress }) => {
          pollCalls += 1;
          assert.equal(taskId, originalTaskId);
          await onProgress(1);
          return { kind: 'url', value: `https://boundles.cc/v1/videos/${taskId}/content`, taskId };
        }
      }
    });
    try {
      await restartedRuntime.scheduler.waitForIdle();
      const recovered = restartedRuntime.jobs.getJob(jobId);
      assert.equal(recovered.status, 'succeeded');
      assert.equal(recovered.output.media.source.taskId, originalTaskId);
      assert.equal(submitCalls, 0);
      assert.equal(pollCalls, 1);
      assert.ok(fs.existsSync(restartedRuntime.media.resolveFile(projectId, recovered.output.media.id).filePath));
    } finally {
      restartedRuntime.close();
    }
  } finally {
    firstRuntime?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
