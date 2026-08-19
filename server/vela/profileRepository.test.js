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
      provider: 'YMAN',
      models: { prompt: 'text-model', image: 'image-model', video: 'seedance-model', analysis: 'qwen-vl-model' },
      endpoints: { videoGeneration: '/videos/tasks', videoStatus: '/videos/tasks/{id}' }
    });
    assert.equal(created.baseUrl, 'https://api.yman.cc/v1');
    assert.equal(created.secretConfigured, true);
    assert.equal(created.provider, 'YMAN');
    assert.equal(created.models.video, 'seedance-model');
    assert.equal(created.models.analysis, 'qwen-vl-model');
    assert.equal(created.endpoints.chat, '/chat/completions');
    assert.equal(created.endpoints.videoGeneration, '/videos/tasks');
    assert.equal(created.endpoints.videoStatus, '/videos/tasks/{id}');
    assert.doesNotMatch(JSON.stringify(created), /sk-test|apiKey/);

    const row = database.connection.prepare('SELECT public_json, encrypted_secret FROM profiles WHERE id = ?').get(created.id);
    assert.doesNotMatch(row.public_json, /sk-test|apiKey/);
    assert.doesNotMatch(Buffer.from(row.encrypted_secret).toString('utf8'), /sk-test/);
    assert.equal(repository.getWithSecret(created.id).secret.apiKey, apiKey);

    const updated = repository.update(created.id, { name: 'YMAN 图片账户', models: { image: 'image-v2' } });
    assert.equal(updated.name, 'YMAN 图片账户');
    assert.equal(updated.models.prompt, 'text-model');
    assert.equal(updated.models.image, 'image-v2');
    assert.equal(updated.models.video, 'seedance-model');
    assert.equal(updated.models.analysis, 'qwen-vl-model');
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

test('GPT profile rejects absolute or unsafe endpoint routes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-profile-route-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 5) }));
  try {
    assert.throws(() => repository.create({
      type: 'gpt', name: '坏路径', baseUrl: 'https://api.example.test/v1', apiKey: 'secret',
      endpoints: { chat: 'https://evil.example/chat' }
    }), /相对路径/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy GPT profile rows receive current model and endpoint defaults when read', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-profile-legacy-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 6) }));
  const now = new Date(0).toISOString();
  try {
    database.connection.prepare(`
      INSERT INTO profiles(id, type, name, public_json, encrypted_secret, created_at, updated_at)
      VALUES (?, 'gpt', ?, ?, NULL, ?, ?)
    `).run('legacy-gpt', '旧版账户', JSON.stringify({
      baseUrl: 'https://api.example.test/v1',
      authType: 'bearer',
      provider: 'Legacy',
      models: { prompt: 'text-model', image: 'image-model' },
      timeoutMs: 60_000,
      maxConcurrency: 2
    }), now, now);

    const profile = repository.get('legacy-gpt');
    assert.equal(profile.models.video, '');
    assert.equal(profile.models.analysis, '');
    assert.equal(profile.endpoints.models, '/models');
    assert.equal(profile.endpoints.chat, '/chat/completions');
    assert.equal(profile.endpoints.videoGeneration, '/videos/generations');
    assert.equal(profile.endpoints.videoStatus, '/videos/{id}');
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
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

test('profile list marks credentials unreadable instead of crashing after a key mismatch', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-profile-key-mismatch-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  try {
    const writer = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 1) }));
    const created = writer.create({
      type: 'gpt', name: 'Unreadable', baseUrl: 'https://relay.test/v1', apiKey: 'sk-never-return',
      models: { prompt: 'text-model', image: 'image-model' }
    });
    const reader = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 2) }));
    const listed = reader.list();
    assert.equal(listed[0].credentialStatus, 'unreadable');
    assert.equal(reader.getWithSecret(created.id).secret, null);
    assert.doesNotMatch(JSON.stringify(listed), /sk-never-return/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AutoDL Pro power settings keep the developer token encrypted and separate from Comfy auth', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-autodl-power-profile-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 4) }));
  const developerToken = 'autodl-developer-token-plaintext';
  try {
    const created = repository.create({
      type: 'comfy',
      name: 'AutoDL Pro H3',
      platform: 'autodl',
      baseUrl: 'http://127.0.0.1:18188',
      transport: 'ssh',
      sshHost: 'connect.example.autodl.com',
      sshPrivateKeyPath: 'C:\\Users\\Tester\\.ssh\\vela-autodl',
      authType: 'none',
      autoPowerEnabled: true,
      autodlInstanceUuid: 'pro-76576c61fdf1',
      autodlDeveloperToken: developerToken,
      idleShutdownMinutes: 7,
      powerOnTimeoutMs: 720_000
    });

    assert.equal(created.autoPowerEnabled, true);
    assert.equal(created.autoPowerProvider, 'autodl-pro');
    assert.equal(created.autodlInstanceUuid, 'pro-76576c61fdf1');
    assert.equal(created.idleShutdownMinutes, 7);
    assert.equal(created.powerOnTimeoutMs, 720_000);
    assert.equal(created.autoPowerCredentialConfigured, true);
    assert.equal(created.autoPowerCredentialStatus, 'ready');
    assert.doesNotMatch(JSON.stringify(created), /developer-token|autodlDeveloperToken/);
    assert.equal(repository.getWithSecret(created.id).secret.autodlDeveloperToken, developerToken);

    const updated = repository.update(created.id, { notes: 'keep power token', idleShutdownMinutes: 9 });
    assert.equal(updated.idleShutdownMinutes, 9);
    assert.equal(repository.getWithSecret(created.id).secret.autodlDeveloperToken, developerToken);

    const row = database.connection.prepare('SELECT public_json, encrypted_secret FROM profiles WHERE id = ?').get(created.id);
    assert.doesNotMatch(row.public_json, /developer-token|autodlDeveloperToken/);
    assert.doesNotMatch(Buffer.from(row.encrypted_secret).toString('utf8'), /developer-token/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AutoDL automatic power rejects ordinary instance IDs and missing developer tokens', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-autodl-power-invalid-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  const repository = new ProfileRepository(database, new SecretProtector({ key: Buffer.alloc(32, 3) }));
  const base = {
    type: 'comfy', name: 'AutoDL', platform: 'autodl', baseUrl: 'http://127.0.0.1:18188',
    transport: 'ssh', sshHost: 'connect.example.autodl.com', sshPrivateKeyPath: 'C:\\key', authType: 'none',
    autoPowerEnabled: true
  };
  try {
    assert.throws(() => repository.create({
      ...base,
      autodlInstanceUuid: '14ff4b9f2b-74ac3ead',
      autodlDeveloperToken: 'token'
    }), /Pro UUID/);
    assert.throws(() => repository.create({
      ...base,
      autodlInstanceUuid: 'pro-76576c61fdf1'
    }), /Developer Token/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
