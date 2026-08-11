import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAiCompatibleProvider, ProviderError } from './openAiCompatibleProvider.js';

const profile = (patch = {}) => ({
  id: 'gpt-main',
  baseUrl: 'https://fixture.test/v1',
  timeoutMs: 100,
  models: { prompt: 'text-ok', image: 'image-ok' },
  ...patch
});

const response = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('connection test lists models and detects authentication and model errors', async () => {
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: async (_url, options) => options.headers.Authorization === 'Bearer good-key'
      ? response(200, { object: 'list', data: [{ id: 'text-ok' }, { id: 'image-ok' }] })
      : response(401, { error: { message: 'bad key' } })
  });
  const connected = await provider.testConnection(profile(), 'good-key');
  assert.deepEqual(connected.models, ['image-ok', 'text-ok']);
  await assert.rejects(() => provider.testConnection(profile(), 'bad-key'), (error) => {
    assert.equal(error.code, 'AUTH_FAILED');
    return true;
  });
  await assert.rejects(() => provider.testConnection(profile({ models: { prompt: 'missing', image: 'image-ok' } }), 'good-key'), (error) => {
    assert.equal(error.code, 'MODEL_NOT_FOUND');
    assert.deepEqual(error.details.missingModels, ['missing']);
    assert.deepEqual(error.details.availableModels, ['image-ok', 'text-ok']);
    return true;
  });
});

test('timeout is classified separately without leaking the bearer key', async () => {
  const secret = 'sk-timeout-secret';
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error(`Bearer ${secret}`), { name: 'AbortError' })));
    })
  });
  await assert.rejects(() => provider.listModels(profile({ timeoutMs: 5 }), secret), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.doesNotMatch(error.message, /sk-timeout-secret/);
    return true;
  });
});

test('GET retries transient failures, but image POST is submitted only once', async () => {
  let getCalls = 0;
  const getProvider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    fetchImpl: async () => {
      getCalls += 1;
      return getCalls < 3
        ? response(429, { error: { message: 'slow down' } })
        : response(200, { data: [{ id: 'text-ok' }, { id: 'image-ok' }] });
    }
  });
  assert.equal((await getProvider.listModels(profile(), 'key')).length, 2);
  assert.equal(getCalls, 3);

  let postCalls = 0;
  const postProvider = new OpenAiCompatibleProvider({
    fetchImpl: async () => {
      postCalls += 1;
      return response(503, { error: { message: 'temporary outage' } });
    }
  });
  await assert.rejects(() => postProvider.generateImages(profile(), 'key', { prompt: 'a product' }), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.retryable, true);
    assert.equal(error.safeToRetry, false);
    return true;
  });
  assert.equal(postCalls, 1);
});

test('image POST retries only failures proven to happen before submission', async () => {
  let safeCalls = 0;
  const safeProvider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      safeCalls += 1;
      assert.equal(options.headers['Idempotency-Key'], 'job-stable-id');
      if (safeCalls < 3) {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
        });
      }
      return response(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });
    }
  });
  await safeProvider.generateImages(profile(), 'key', { prompt: 'a product', idempotencyKey: 'job-stable-id' });
  assert.equal(safeCalls, 3);

  let ambiguousCalls = 0;
  const ambiguousProvider = new OpenAiCompatibleProvider({
    fetchImpl: async () => {
      ambiguousCalls += 1;
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
      });
    }
  });
  await assert.rejects(() => ambiguousProvider.generateImages(profile(), 'key', { prompt: 'a product' }), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.details.networkCode, 'ECONNRESET');
    assert.equal(error.safeToRetry, false);
    return true;
  });
  assert.equal(ambiguousCalls, 1);
});

test('image generation has a five-minute floor instead of the short profile probe timeout', async () => {
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response(200, { data: [{ b64_json: Buffer.from('slow-image').toString('base64') }] });
    }
  });
  const images = await provider.generateImages(profile({ timeoutMs: 5 }), 'key', { prompt: '慢速图片' });
  assert.equal(images[0].kind, 'base64');
});

test('prompt and image responses are normalized for the canvas', async () => {
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: async (url) => url.endsWith('/chat/completions')
      ? response(200, { choices: [{ message: { content: '优化后的商品镜头' } }] })
      : response(200, { data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] })
  });
  const optimized = await provider.optimizePrompt(profile(), 'key', { prompt: '商品特写' });
  assert.equal(optimized.text, '优化后的商品镜头');
  assert.equal(optimized.source.model, 'text-ok');
  const images = await provider.generateImages(profile(), 'key', { prompt: '商品图' });
  assert.equal(images[0].kind, 'base64');
});

test('reference image request uses multipart edit endpoint exactly once', async () => {
  let calls = 0;
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.ok(url.endsWith('/images/edits'));
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('model'), 'image-ok');
      assert.ok(options.body.get('image') instanceof Blob);
      return response(200, { data: [{ b64_json: Buffer.from('edited').toString('base64') }] });
    }
  });
  const images = await provider.editImages(profile(), 'key', {
    prompt: '保留商品，替换背景',
    referenceImages: [{ data: Buffer.from('reference'), mime: 'image/png', filename: 'reference.png' }]
  });
  assert.equal(images[0].kind, 'base64');
  assert.equal(calls, 1);
});

test('custom compatible endpoint paths are honored', async () => {
  const seen = [];
  const provider = new OpenAiCompatibleProvider({
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.endsWith('/catalog/models')) return response(200, { data: [{ id: 'text-ok' }, { id: 'image-ok' }] });
      if (url.endsWith('/v2/chat')) return response(200, { choices: [{ message: { content: 'ok' } }] });
      return response(200, { data: [{ b64_json: Buffer.from('image').toString('base64') }] });
    }
  });
  const configured = profile({
    endpoints: {
      models: '/catalog/models',
      chat: '/v2/chat',
      imageGeneration: '/v2/images',
      imageEdit: '/v2/images/edit'
    }
  });
  await provider.testConnection(configured, 'key');
  await provider.optimizePrompt(configured, 'key', { prompt: 'x' });
  await provider.generateImages(configured, 'key', { prompt: 'x' });
  assert.deepEqual(seen, [
    'https://fixture.test/v1/catalog/models',
    'https://fixture.test/v1/v2/chat',
    'https://fixture.test/v1/v2/images'
  ]);
});

test('Boundless video request submits once, persists the task id and polls progress', async () => {
  const seen = [];
  const submitted = [];
  const progress = [];
  const provider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    videoPollIntervalMs: 0,
    fetchImpl: async (url, options) => {
      seen.push({ url, method: options.method, body: options.body, headers: options.headers });
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.deepEqual(body, {
          model: 'seedance-2.5-720p',
          prompt: '模特转身并看向镜头',
          seconds: 10,
          ratio: '9:16',
          resolution: '720p',
          image_urls: ['https://images.example/reference.png']
        });
        assert.equal(options.headers['Idempotency-Key'], 'video-job-1');
        return response(200, { id: 'video-task-1', status: 'queued' });
      }
      if (seen.filter((item) => item.method === 'GET').length === 1) {
        return response(200, { task_id: 'video-task-1', status: 'processing', progress: 35 });
      }
      return response(200, { id: 'video-task-1', status: 'completed', progress: 100, metadata: { url: 'https://cdn.example/result.mp4' } });
    }
  });
  const result = await provider.generateVideo(profile({
    models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
    endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
  }), 'key', {
    prompt: '模特转身并看向镜头',
    seconds: 10,
    ratio: '9:16',
    resolution: '720p',
    imageUrls: ['https://images.example/reference.png'],
    idempotencyKey: 'video-job-1',
    onSubmitted: (taskId) => submitted.push(taskId),
    onProgress: (value) => progress.push(value)
  });
  assert.deepEqual(submitted, ['video-task-1']);
  assert.deepEqual(progress, [0.35, 1]);
  assert.deepEqual(result, { kind: 'url', value: 'https://cdn.example/result.mp4', taskId: 'video-task-1' });
  assert.equal(seen.filter((item) => item.method === 'POST').length, 1);
  assert.equal(seen[1].url, 'https://fixture.test/v1/videos/video-task-1');
});

test('video polling exposes the upstream failure without resubmitting the paid task', async () => {
  let postCalls = 0;
  const provider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    videoPollIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        postCalls += 1;
        return response(200, { task_id: 'failed-task' });
      }
      return response(200, { task_id: 'failed-task', status: 'failed', error: { message: 'reference image is not publicly reachable' } });
    }
  });
  await assert.rejects(() => provider.generateVideo(profile({
    models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
    endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
  }), 'key', { prompt: '测试视频', seconds: 5 }), (error) => {
    assert.equal(error.code, 'VIDEO_TASK_FAILED');
    assert.match(error.message, /reference image is not publicly reachable/);
    assert.equal(error.safeToRetry, false);
    return true;
  });
  assert.equal(postCalls, 1);
});

test('Boundless 480p profile submits the matching lower-cost resolution', async () => {
  let submittedBody;
  const provider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    videoPollIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        submittedBody = JSON.parse(options.body);
        return response(200, { id: 'video-task-480p', status: 'queued' });
      }
      return response(200, {
        id: 'video-task-480p',
        status: 'completed',
        metadata: { url: 'https://cdn.example/result-480p.mp4' }
      });
    }
  });
  await provider.generateVideo(profile({
    models: { prompt: '', image: '', video: 'seedance-2.5-480p' },
    endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
  }), 'key', {
    prompt: '低清晰度 5 秒视频',
    seconds: 5,
    ratio: '16:9',
    resolution: '480p'
  });
  assert.equal(submittedBody.model, 'seedance-2.5-480p');
  assert.equal(submittedBody.resolution, '480p');
});

test('Boundless unknown status is treated as propagation delay and keeps polling the same task', async () => {
  let postCalls = 0;
  let getCalls = 0;
  const progress = [];
  const provider = new OpenAiCompatibleProvider({
    sleep: async () => {},
    videoPollIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        postCalls += 1;
        return response(200, { task_id: 'propagating-task', status: 'unknown' });
      }
      getCalls += 1;
      if (getCalls === 1) {
        return response(200, { task_id: 'propagating-task', status: 'unknown', progress: 0 });
      }
      return response(200, {
        task_id: 'propagating-task',
        status: 'completed',
        progress: 100,
        metadata: { url: 'https://cdn.example/result.mp4' }
      });
    }
  });
  const result = await provider.generateVideo(profile({
    models: { prompt: '', image: '', video: 'seedance-2.5-720p' },
    endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
  }), 'key', {
    prompt: '测试视频', seconds: 5, onProgress: (value) => progress.push(value)
  });
  assert.equal(postCalls, 1);
  assert.equal(getCalls, 2);
  assert.deepEqual(progress, [0, 1]);
  assert.equal(result.taskId, 'propagating-task');
});

test('Boundless in_progress status remains pollable and never creates a second task', async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    videoPollIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if ((options.method || 'GET') === 'POST') {
        return new Response(JSON.stringify({ id: 'task-in-progress' }), { status: 200 });
      }
      const pollCount = calls.filter((call) => call.method === 'GET').length;
      return new Response(JSON.stringify(pollCount === 1
        ? { id: 'task-in-progress', status: 'in_progress', progress: 25 }
        : { id: 'task-in-progress', status: 'completed', metadata: { url: 'https://boundles.cc/v1/videos/task-in-progress/content' } }), { status: 200 });
    }
  });
  const progress = [];
  const result = await provider.generateVideo({
    baseUrl: 'https://boundles.cc/v1',
    timeoutMs: 1000,
    models: { video: 'seedance-2.5-720p' },
    endpoints: { videoGeneration: '/videos', videoStatus: '/videos/{id}' }
  }, 'secret', {
    prompt: 'test',
    seconds: 5,
    ratio: '16:9',
    resolution: '720p',
    onProgress: async (value) => progress.push(value)
  });

  assert.equal(result.taskId, 'task-in-progress');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.deepEqual(progress, [0.25, 1]);
});

test('video input is validated before a billable submission', async () => {
  let calls = 0;
  const provider = new OpenAiCompatibleProvider({ fetchImpl: async () => { calls += 1; return response(500, {}); } });
  const videoProfile = profile({ models: { prompt: '', image: '', video: 'seedance-2.5-720p' } });
  await assert.rejects(() => provider.generateVideo(videoProfile, 'key', { prompt: 'x', seconds: 181 }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(() => provider.generateVideo(videoProfile, 'key', { prompt: 'x', seconds: 5, resolution: '1080p' }), (error) => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});
