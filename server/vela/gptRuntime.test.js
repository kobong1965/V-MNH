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
      generateImages: async (_profile, apiKey, input) => {
        assert.equal(apiKey, 'sk-runtime-secret');
        assert.equal(input.prompt, '商品主图');
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
      payload: { nodeKind: 'gpt-image', prompt: '商品主图' }, count: 1, seedMode: 'fixed', seed: 1
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
