import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { VelaRuntime } from './runtime.js';
import { SecretProtector } from './secretProtector.js';
import { AUTO_COMFY_PROFILE_ID } from '../../shared/vela-contracts.js';

const saveReference = async (runtime, projectId, name, color) => {
  const data = await sharp({ create: { width: 128, height: 128, channels: 3, background: color } }).png().toBuffer();
  return runtime.media.saveUploadedMedia(projectId, { dataUrl: `data:image/png;base64,${data.toString('base64')}`, fileName: name });
};

const mediaFetch = async () => new Response(Buffer.from('h3-video'), { status: 200, headers: { 'Content-Type': 'video/mp4' } });

test('Comfy H3 R2V uploads every reference, persists prompt id and downloads the video', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-comfy-r2v-runtime-'));
  const uploads = [];
  let submittedGraph;
  const provider = {
    uploadImage: async (_profile, _secret, input) => { uploads.push(input.filename); return `vela/${input.filename}`; },
    submitPrompt: async (_profile, _secret, graph) => { submittedGraph = graph; return { promptId: 'r2v-prompt', clientId: 'r2v-client' }; },
    waitForPrompt: async (_profile, _secret, promptId, { onProgress }) => {
      assert.equal(promptId, 'r2v-prompt'); onProgress(0.5);
      return { outputs: { 16: { images: [{ filename: 'h3-r2v.mp4', subfolder: 'vela', type: 'output' }] } } };
    },
    findVideoOutput: (history, preferred) => { assert.deepEqual(preferred, ['16']); return history.outputs[16].images[0]; },
    createViewUrl: () => 'http://127.0.0.1:18188/view?filename=h3-r2v.mp4',
    close: () => {}
  };
  const runtime = new VelaRuntime({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects'), secretProtector: new SecretProtector({ key: Buffer.alloc(32, 6) }), comfyProvider: provider, mediaFetch });
  try {
    const project = runtime.projectStore.saveProject({ name: 'H3 R2V', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const person = await saveReference(runtime, project.id, 'person.png', { r: 80, g: 120, b: 160 });
    const scene = await saveReference(runtime, project.id, 'scene.png', { r: 40, g: 70, b: 90 });
    const prop = await saveReference(runtime, project.id, 'prop.png', { r: 180, g: 130, b: 70 });
    const profile = runtime.createProfile({ type: 'comfy', name: 'AutoDL H3', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188', transport: 'direct', authType: 'none', maxConcurrency: 1 });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'h3-node', profileId: profile.id, providerType: 'comfy',
      payload: { nodeKind: 'h3-video', prompt: '<Picture 1>人物在<Picture 2>场景中拿起<Picture 3>道具', duration: 5, aspectRatio: '16:9', resolution: '720p', videoGenerationMode: 'reference-to-video', referenceUrls: [person.url, scene.url, prop.url], requiredReferenceCount: 3, h3Acceleration: 'turbo-4' },
      count: 1, seedMode: 'fixed', seed: 42
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.promptId, 'r2v-prompt');
    assert.equal(job.output.media.kind, 'video');
    assert.equal(uploads.length, 3);
    assert.equal(submittedGraph['6'].class_type, 'MiniMaxH3ReferenceToVideo');
    assert.deepEqual(submittedGraph['6'].inputs['ref_images.ref_image_2'], ['22', 0]);
    assert.equal(submittedGraph['10'].inputs.steps, 4);
  } finally { runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('AutoDL Pro H3 R2V job powers on once before submitting the Comfy prompt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-autodl-r2v-power-'));
  const order = [];
  const powerProvider = { getStatus: async () => 'stopped', powerOn: async () => { order.push('power-on'); }, waitForState: async () => { order.push('running'); return 'running'; }, powerOff: async () => { order.push('power-off'); } };
  const provider = {
    uploadImage: async () => 'vela/reference.png',
    submitPrompt: async () => { order.push('submit'); return { promptId: 'power-prompt', clientId: 'power-client' }; },
    waitForPrompt: async () => ({ outputs: { 16: { images: [{ filename: 'power.mp4', subfolder: 'vela', type: 'output' }] } } }),
    findVideoOutput: (history) => history.outputs[16].images[0], createViewUrl: () => 'http://127.0.0.1:18188/view?filename=power.mp4', getStatus: async () => ({ queue: { running: 0, pending: 0 } }), close: () => {}
  };
  const runtime = new VelaRuntime({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects'), secretProtector: new SecretProtector({ key: Buffer.alloc(32, 8) }), comfyProvider: provider, powerProvider, mediaFetch });
  try {
    const project = runtime.projectStore.saveProject({ name: 'AutoDL R2V', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const reference = await saveReference(runtime, project.id, 'reference.png', { r: 80, g: 80, b: 80 });
    const profile = runtime.createProfile({ type: 'comfy', name: 'AutoDL Pro H3', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188', transport: 'direct', authType: 'none', maxConcurrency: 1, autoPowerEnabled: true, autodlInstanceUuid: 'pro-76576c61fdf1', autodlDeveloperToken: 'encrypted-by-repository' });
    const group = runtime.createJobGroup({ projectId: project.id, nodeId: 'h3-node', profileId: profile.id, providerType: 'comfy', payload: { nodeKind: 'h3-video', prompt: '云端 GPU R2V', duration: 5, aspectRatio: '16:9', resolution: '720p', videoGenerationMode: 'reference-to-video', referenceUrls: [reference.url], requiredReferenceCount: 1 }, count: 1, seedMode: 'fixed', seed: 7 });
    await runtime.scheduler.waitForIdle();
    assert.equal(runtime.jobs.getJob(group.jobs[0].id).status, 'succeeded');
    assert.deepEqual(order.slice(0, 3), ['power-on', 'running', 'submit']);
    assert.equal(order.filter((entry) => entry === 'power-on').length, 1);
  } finally { runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('managed AutoDL comprehensive test reports an offline instance without opening SSH', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-autodl-offline-test-'));
  let comfyConnectionCalls = 0;
  const provider = {
    testConnection: async () => {
      comfyConnectionCalls += 1;
      throw new Error('SSH must not be opened for a powered-off diagnostic');
    },
    close: () => {}
  };
  const powerManager = {
    isEnabled: () => true,
    test: async (profileId) => ({
      ok: true,
      profileId,
      remoteState: 'shutdown',
      checkedAt: '2026-08-21T10:00:00.000Z'
    }),
    scheduleIdleShutdown: () => false,
    close: () => {}
  };
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 9) }),
    comfyProvider: provider,
    powerManager,
    mediaFetch
  });
  try {
    const profile = runtime.createProfile({
      type: 'comfy',
      name: 'AutoDL H3 GPU 2',
      platform: 'autodl',
      baseUrl: 'http://127.0.0.1:18189',
      transport: 'ssh',
      sshHost: 'connect.westd.seetacloud.com',
      sshPort: 32796,
      sshUsername: 'root',
      sshPrivateKeyPath: 'C:\\fixture\\id_ed25519',
      sshStartScript: '/root/autostart.sh',
      authType: 'none',
      maxConcurrency: 1,
      autoPowerEnabled: true,
      autodlInstanceUuid: 'pro-78724ddf7edf',
      autodlDeveloperToken: 'encrypted-by-repository'
    });
    const result = await runtime.testProfile(profile.id);
    assert.equal(result.ok, true);
    assert.equal(result.type, 'comfy');
    assert.equal(result.state, 'offline');
    assert.equal(result.power.remoteState, 'shutdown');
    assert.equal(result.queue.running, 0);
    assert.equal(comfyConnectionCalls, 0);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('automatic H3 R2V routing sends concurrent nodes to different least-loaded profiles', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-dual-r2v-runtime-'));
  const submissions = [];
  let releasePrompts;
  const promptGate = new Promise((resolve) => { releasePrompts = resolve; });
  const provider = {
    uploadImage: async (_profile, _secret, input) => `vela/${input.filename}`,
    submitPrompt: async (profile) => { submissions.push(profile.id); return { promptId: `prompt-${profile.id}`, clientId: `client-${profile.id}` }; },
    waitForPrompt: async (profile) => { await promptGate; return { outputs: { 16: { images: [{ filename: `${profile.id}.mp4`, subfolder: 'vela', type: 'output' }] } } }; },
    findVideoOutput: (history) => history.outputs[16].images[0], createViewUrl: (_profile, output) => `http://127.0.0.1:18188/view?filename=${output.filename}`, close: () => {}
  };
  const runtime = new VelaRuntime({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects'), secretProtector: new SecretProtector({ key: Buffer.alloc(32, 12) }), comfyProvider: provider, mediaFetch });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Dual R2V', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const reference = await saveReference(runtime, project.id, 'shared.png', { r: 90, g: 90, b: 90 });
    const first = runtime.createProfile({ type: 'comfy', name: 'GPU A', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188', transport: 'direct', authType: 'none', maxConcurrency: 1, workflowVersion: 'minimax-h3-r2v-v1', tags: ['MiniMax H3'] });
    const second = runtime.createProfile({ type: 'comfy', name: 'GPU B', platform: 'autodl', baseUrl: 'http://127.0.0.1:18189', transport: 'direct', authType: 'none', maxConcurrency: 1, workflowVersion: 'minimax-h3-r2v-v1', tags: ['MiniMax H3'] });
    const draft = (nodeId) => ({ projectId: project.id, nodeId, profileId: AUTO_COMFY_PROFILE_ID, providerType: 'comfy', payload: { nodeKind: 'h3-video', prompt: nodeId, duration: 5, aspectRatio: '16:9', resolution: '720p', videoGenerationMode: 'reference-to-video', referenceUrls: [reference.url], requiredReferenceCount: 1 }, count: 1, seedMode: 'fixed', seed: 11 });
    const firstGroup = runtime.createJobGroup(draft('node-a'));
    const secondGroup = runtime.createJobGroup(draft('node-b'));
    assert.equal(firstGroup.group.profileId, first.id); assert.equal(secondGroup.group.profileId, second.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(new Set(submissions), new Set([first.id, second.id]));
    releasePrompts(); await runtime.scheduler.waitForIdle();
    assert.equal(runtime.jobs.getJob(firstGroup.jobs[0].id).status, 'succeeded');
    assert.equal(runtime.jobs.getJob(secondGroup.jobs[0].id).status, 'succeeded');
  } finally { releasePrompts?.(); runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('H3 job contract rejects old first-frame mode and incomplete R2V references before billing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-r2v-contract-'));
  const runtime = new VelaRuntime({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects'), secretProtector: new SecretProtector({ key: Buffer.alloc(32, 13) }), comfyProvider: { close: () => {} }, mediaFetch });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Contract', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const profile = runtime.createProfile({ type: 'comfy', name: 'H3', baseUrl: 'http://127.0.0.1:18188', transport: 'direct', authType: 'none' });
    assert.throws(() => runtime.createJobGroup({ projectId: project.id, nodeId: 'old', profileId: profile.id, providerType: 'comfy', payload: { nodeKind: 'h3-video', prompt: 'old', videoGenerationMode: 'image-to-video', referenceUrls: ['/one.png'] }, count: 1, seedMode: 'fixed', seed: 1 }), /仅支持 R2V/);
    assert.throws(() => runtime.createJobGroup({ projectId: project.id, nodeId: 'missing', profileId: profile.id, providerType: 'comfy', payload: { nodeKind: 'h3-video', prompt: 'missing', videoGenerationMode: 'reference-to-video', referenceUrls: ['/one.png'], requiredReferenceCount: 2 }, count: 1, seedMode: 'fixed', seed: 1 }), /数量不一致/);
  } finally { runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
