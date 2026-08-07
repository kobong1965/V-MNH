import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VelaDatabase } from './database.js';
import { ProfileRepository, normalizeOpenAiBaseUrl } from './profileRepository.js';
import { SecretProtector } from './secretProtector.js';

test('GPT profile stores only encrypted secret and returns a secret-free public shape', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-profile-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  const database = new VelaDatabase(databasePath);
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 7) }));
  const apiKey = 'sk-test-plaintext-must-not-survive';
  try {
    const created = repository.create({
      type: 'gpt',
      name: 'YMAN 主账户',
      baseUrl: 'https://api.yman.cc/V1/',
      apiKey,
      models: { prompt: 'text-model', image: 'image-model' }
    });
    assert.equal(created.baseUrl, 'https://api.yman.cc/v1');
    assert.equal(created.secretConfigured, true);
    assert.doesNotMatch(JSON.stringify(created), /sk-test|apiKey/);

    const row = database.connection.prepare('SELECT public_json, encrypted_secret FROM profiles WHERE id = ?').get(created.id);
    assert.doesNotMatch(row.public_json, /sk-test|apiKey/);
    assert.doesNotMatch(Buffer.from(row.encrypted_secret).toString('utf8'), /sk-test/);
    assert.equal(repository.getWithSecret(created.id).secret.apiKey, apiKey);

    const updated = repository.update(created.id, { name: 'YMAN 图片账户', models: { image: 'image-v2' } });
    assert.equal(updated.name, 'YMAN 图片账户');
    assert.equal(updated.models.prompt, 'text-model');
    assert.equal(updated.models.image, 'image-v2');
    assert.equal(repository.getWithSecret(created.id).secret.apiKey, apiKey);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('base URL validation rejects unsupported or malformed addresses', () => {
  assert.throws(() => normalizeOpenAiBaseUrl('not-a-url'));
  assert.throws(() => normalizeOpenAiBaseUrl('file:///tmp/provider'));
  assert.equal(normalizeOpenAiBaseUrl('http://127.0.0.1:3000/v1/'), 'http://127.0.0.1:3000/v1');
});

test('ComfyUI profile encrypts authentication and exposes only safe connection fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-comfy-profile-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 9) }));
  try {
    const created = repository.create({
      type: 'comfy',
      name: 'AutoDL 5090',
      platform: 'autodl',
      baseUrl: 'https://gpu.example.test/comfy/',
      authType: 'custom',
      customHeaders: { 'X-API-Key': 'cloud-secret' },
      maxConcurrency: 2,
      workflowVersion: 'h3-v1',
      tags: ['H3', '5090']
    });
    assert.equal(created.baseUrl, 'https://gpu.example.test/comfy');
    assert.equal(created.websocketUrl, 'wss://gpu.example.test/comfy/ws');
    assert.deepEqual(created.customHeaderNames, ['x-api-key']);
    assert.equal(created.secretConfigured, true);
    assert.doesNotMatch(JSON.stringify(created), /cloud-secret|customHeaders/);
    assert.deepEqual(repository.getWithSecret(created.id).secret.customHeaders, { 'x-api-key': 'cloud-secret' });

    const row = database.connection.prepare('SELECT public_json, encrypted_secret FROM profiles WHERE id = ?').get(created.id);
    assert.doesNotMatch(row.public_json, /cloud-secret/);
    assert.doesNotMatch(Buffer.from(row.encrypted_secret).toString('utf8'), /cloud-secret/);

    const updated = repository.update(created.id, { maxConcurrency: 3, notes: '主视频算力' });
    assert.equal(updated.maxConcurrency, 3);
    assert.equal(updated.notes, '主视频算力');
    assert.deepEqual(repository.getWithSecret(created.id).secret.customHeaders, { 'x-api-key': 'cloud-secret' });
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
