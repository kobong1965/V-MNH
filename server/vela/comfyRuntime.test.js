import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { VelaRuntime } from './runtime.js';
import { SecretProtector } from './secretProtector.js';

test('Comfy H3 job uploads a reference, persists prompt id and downloads the video', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-comfy-runtime-'));
  let submittedGraph;
  const provider = {
    uploadImage: async (_profile, _secret, input) => {
      assert.equal(input.mime, 'image/png');
      return 'vela/reference.png';
    },
    submitPrompt: async (_profile, _secret, graph) => {
      submittedGraph = graph;
      return { promptId: 'comfy-prompt-1', clientId: 'vela-client-1' };
    },
    waitForPrompt: async (_profile, _secret, promptId, { onProgress }) => {
      assert.equal(promptId, 'comfy-prompt-1');
      onProgress(0.5);
      return { outputs: { 16: { images: [{ filename: 'h3.mp4', subfolder: 'vela', type: 'output' }] } } };
    },
    findVideoOutput: (history) => history.outputs[16].images[0],
    createViewUrl: () => 'http://127.0.0.1:18188/view?filename=h3.mp4',
    close: () => {}
  };
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 6) }),
    comfyProvider: provider,
    mediaFetch: async () => new Response(Buffer.from('h3-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    })
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'H3', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const referencePng = await sharp({
      create: { width: 160, height: 90, channels: 3, background: { r: 80, g: 120, b: 160 } }
    }).png().toBuffer();
    const reference = runtime.media.saveUploadedMedia(project.id, {
      dataUrl: `data:image/png;base64,${referencePng.toString('base64')}`,
      fileName: 'reference.png'
    });
    const profile = runtime.createProfile({
      type: 'comfy', name: 'AutoDL H3', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188',
      transport: 'direct', authType: 'none', maxConcurrency: 1
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'h3-node', profileId: profile.id, providerType: 'comfy',
      payload: {
        nodeKind: 'h3-video', prompt: '人物向前走', duration: 5, aspectRatio: '16:9', resolution: '720p',
        videoGenerationMode: 'image-to-video', referenceUrls: [reference.url], h3Acceleration: 'turbo-8'
      },
      count: 1, seedMode: 'fixed', seed: 42
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.promptId, 'comfy-prompt-1');
    assert.equal(job.output.media.kind, 'video');
    assert.equal(submittedGraph['6'].inputs.first_frame[0], '22');
    assert.equal(submittedGraph['22'].inputs.crop, 'center');
    assert.equal(submittedGraph['10'].inputs.steps, 8);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Wan processing job uploads role inputs, converts the hidden UI workflow and preserves backend execution', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-wan-runtime-'));
  const uploads = [];
  let convertedWorkflow;
  let submittedGraph;
  const provider = {
    uploadMedia: async (_profile, _secret, input) => {
      uploads.push({ mime: input.mime, filename: input.filename });
      return `${input.subfolder}/${input.filename}`;
    },
    convertWorkflow: async (_profile, _secret, workflow) => {
      convertedWorkflow = workflow;
      return { 1: { class_type: 'WanBackend', inputs: { source: 'injected' } } };
    },
    submitPrompt: async (_profile, _secret, graph) => {
      submittedGraph = graph;
      return { promptId: 'wan-prompt-1', clientId: 'wan-client-1' };
    },
    waitForPrompt: async () => ({ outputs: { 99: { videos: [{ filename: 'wan-result.mp4', subfolder: 'vela', type: 'output' }] } } }),
    findVideoOutput: (history) => history.outputs[99].videos[0],
    createViewUrl: () => 'http://127.0.0.1:18188/view?filename=wan-result.mp4',
    close: () => {}
  };
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 7) }),
    comfyProvider: provider,
    mediaFetch: async () => new Response(Buffer.from('wan-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    })
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'Wan', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const video = runtime.media.saveUploadedMedia(project.id, {
      dataUrl: `data:video/mp4;base64,${Buffer.from('source-video').toString('base64')}`,
      fileName: 'source.mp4'
    });
    const image = runtime.media.saveUploadedMedia(project.id, {
      dataUrl: `data:image/png;base64,${Buffer.from('character-image').toString('base64')}`,
      fileName: 'character.png'
    });
    const profile = runtime.createProfile({
      type: 'comfy', name: 'Wan ComfyUI', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188',
      transport: 'direct', authType: 'none', maxConcurrency: 1
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'wan-node', profileId: profile.id, providerType: 'comfy',
      payload: {
        nodeKind: 'wan-video-process', ecommerceWorkflowId: 'wan22-animate-face-outfit',
        workflowInputs: [
          { role: 'source-video', kind: 'video', url: video.url },
          { role: 'character-image', kind: 'image', url: image.url }
        ]
      },
      count: 1, seedMode: 'fixed', seed: 9
    });
    await runtime.scheduler.waitForIdle();
    const job = runtime.jobs.getJob(group.jobs[0].id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.promptId, 'wan-prompt-1');
    assert.deepEqual(uploads.map((item) => item.mime), ['video/mp4', 'image/png']);
    assert.match(convertedWorkflow.nodes.find((node) => String(node.id) === '43').widgets_values.video, /source-video/);
    assert.match(convertedWorkflow.nodes.find((node) => String(node.id) === '44').widgets_values[0], /character-image/);
    assert.equal(submittedGraph[1].class_type, 'WanBackend');
    assert.equal(job.output.media.kind, 'video');
    assert.match(job.output.media.source.model, /^wan2\.2-animate:/);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AutoDL Pro H3 job powers on once before submitting the Comfy prompt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-autodl-power-runtime-'));
  const order = [];
  const powerProvider = {
    getStatus: async () => 'stopped',
    powerOn: async () => { order.push('power-on'); },
    waitForState: async () => { order.push('running'); return 'running'; },
    powerOff: async () => { order.push('power-off'); }
  };
  const provider = {
    submitPrompt: async () => {
      order.push('submit');
      return { promptId: 'autodl-pro-prompt', clientId: 'autodl-pro-client' };
    },
    waitForPrompt: async () => ({
      outputs: { 16: { images: [{ filename: 'autodl-pro.mp4', subfolder: 'vela', type: 'output' }] } }
    }),
    findVideoOutput: (history) => history.outputs[16].images[0],
    createViewUrl: () => 'http://127.0.0.1:18188/view?filename=autodl-pro.mp4',
    getStatus: async () => ({ queue: { running: 0, pending: 0 } }),
    close: () => {}
  };
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 8) }),
    comfyProvider: provider,
    powerProvider,
    mediaFetch: async () => new Response(Buffer.from('autodl-pro-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    })
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'AutoDL Pro', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const profile = runtime.createProfile({
      type: 'comfy', name: 'AutoDL Pro H3', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188',
      transport: 'direct', authType: 'none', maxConcurrency: 1,
      autoPowerEnabled: true,
      autodlInstanceUuid: 'pro-76576c61fdf1',
      autodlDeveloperToken: 'encrypted-by-repository'
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'h3-node', profileId: profile.id, providerType: 'comfy',
      payload: {
        nodeKind: 'h3-video', prompt: '一个正在运行的云端 GPU', duration: 5,
        aspectRatio: '16:9', resolution: '720p', videoGenerationMode: 'text-to-video', referenceUrls: []
      },
      count: 1, seedMode: 'fixed', seed: 7
    });
    await runtime.scheduler.waitForIdle();
    assert.equal(runtime.jobs.getJob(group.jobs[0].id).status, 'succeeded');
    assert.deepEqual(order.slice(0, 3), ['power-on', 'running', 'submit']);
    assert.equal(order.filter((entry) => entry === 'power-on').length, 1);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('mismatched H3 references are AI-expanded once per batch and uploaded at the target ratio', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-h3-outpaint-runtime-'));
  const uploadedDimensions = [];
  let outpaintCalls = 0;
  let promptCounter = 0;
  const provider = {
    uploadImage: async (_profile, _secret, input) => {
      const metadata = await sharp(input.data).metadata();
      uploadedDimensions.push([metadata.width, metadata.height]);
      return `vela/reference-${uploadedDimensions.length}.png`;
    },
    submitPrompt: async () => {
      promptCounter += 1;
      return { promptId: `outpaint-prompt-${promptCounter}`, clientId: `outpaint-client-${promptCounter}` };
    },
    waitForPrompt: async () => ({
      outputs: { 16: { images: [{ filename: 'outpaint-h3.mp4', subfolder: 'vela', type: 'output' }] } }
    }),
    findVideoOutput: (history) => history.outputs[16].images[0],
    createViewUrl: () => 'http://127.0.0.1:18188/view?filename=outpaint-h3.mp4',
    close: () => {}
  };
  const gptProvider = {
    editImages: async (_profile, _apiKey, input) => {
      outpaintCalls += 1;
      assert.equal(input.size, '1024x1536');
      assert.ok(input.mask?.data);
      return [{ kind: 'base64', value: input.referenceImages[0].data.toString('base64') }];
    }
  };
  const runtime = new VelaRuntime({
    dataDirectory: directory,
    projectsDirectory: path.join(directory, 'projects'),
    secretProtector: new SecretProtector({ key: Buffer.alloc(32, 9) }),
    comfyProvider: provider,
    gptProvider,
    mediaFetch: async () => new Response(Buffer.from('h3-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    })
  });
  try {
    const project = runtime.projectStore.saveProject({ name: 'H3 outpaint', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const squarePng = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 160, g: 120, b: 80 } }
    }).png().toBuffer();
    const reference = runtime.media.saveUploadedMedia(project.id, {
      dataUrl: `data:image/png;base64,${squarePng.toString('base64')}`,
      fileName: 'square.png'
    });
    const outpaintProfile = runtime.createProfile({
      type: 'gpt', name: 'Outpaint', baseUrl: 'https://api.example.test/v1', apiKey: 'encrypted-key',
      models: { prompt: '', image: 'gpt-image-2', video: '' }
    });
    const comfyProfile = runtime.createProfile({
      type: 'comfy', name: 'AutoDL H3', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188',
      transport: 'direct', authType: 'none', maxConcurrency: 1
    });
    const group = runtime.createJobGroup({
      projectId: project.id, nodeId: 'h3-node', profileId: comfyProfile.id, providerType: 'comfy',
      payload: {
        nodeKind: 'h3-video', prompt: '模特自然转身', duration: 5, aspectRatio: '9:16', resolution: '720p',
        videoGenerationMode: 'image-to-video', referenceUrls: [reference.url], h3Acceleration: 'turbo-8',
        h3FrameFit: 'ai-expand', h3OutpaintProfileId: outpaintProfile.id
      },
      count: 2, seedMode: 'increment', seed: 21
    });
    await runtime.scheduler.waitForIdle();
    assert.equal(group.jobs.length, 2);
    assert.equal(outpaintCalls, 1);
    assert.deepEqual(uploadedDimensions, [[640, 1152], [640, 1152]]);
    assert.equal(runtime.jobs.getJob(group.jobs[0].id).status, 'succeeded');
    assert.equal(runtime.jobs.getJob(group.jobs[1].id).status, 'succeeded');
    const adapted = runtime.media.list(project.id).filter((item) => item.source?.type === 'h3-ai-outpaint');
    assert.equal(adapted.length, 1);
  } finally {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
