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
