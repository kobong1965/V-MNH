import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRemotePairingAttemptLimiter,
  createPairingService,
  isMaterialsReadOnlyClient,
  isMaterialsReadRouteAllowed,
  isTrustedVelaRequestOrigin,
  isValidRemotePairingScopes,
  MATERIALS_READ_SCOPE,
  VELA_FULL_ACCESS_SCOPE
} from './pairingService.js';

test('pairing code issues a token and persists only its hash', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const paired = service.pair('123456', 'Storyworks test');
    assert.match(paired.token, /^vela_/);
    assert.deepEqual(paired.client.scopes, [VELA_FULL_ACCESS_SCOPE]);
    assert.equal(service.verify(paired.token), true);
    assert.equal(service.verify('vela_invalid'), false);
    assert.deepEqual(service.identify(paired.token), paired.client);
    assert.deepEqual(service.listClients(), [paired.client]);
    assert.deepEqual(service.info().clients, [paired.client]);
    assert.doesNotMatch(JSON.stringify(service.info()), /tokenHash|vela_/);

    const reloaded = createPairingService({ dataDirectory: directory, codeFactory: () => '654321' });
    assert.equal(reloaded.verify(paired.token), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scoped clients keep least privilege and a stable client key replaces the previous token', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const first = service.pair('123456', '小红书素材盘', {
      clientKey: 'xhs-materials',
      scopes: [MATERIALS_READ_SCOPE]
    });
    const second = service.pair('123456', '小红书素材盘', {
      clientKey: 'xhs-materials',
      scopes: [MATERIALS_READ_SCOPE]
    });

    assert.equal(first.client.id, second.client.id);
    assert.equal(service.verify(first.token), false);
    assert.equal(service.verify(second.token), true);
    assert.deepEqual(service.listClients(), [second.client]);
    assert.deepEqual(second.client.scopes, [MATERIALS_READ_SCOPE]);
    assert.doesNotMatch(JSON.stringify(service.info()), /xhs-materials|tokenHash|vela_/);

    const reloaded = createPairingService({ dataDirectory: directory, codeFactory: () => '654321' });
    assert.deepEqual(reloaded.identify(second.token)?.scopes, [MATERIALS_READ_SCOPE]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pairing rejects unsupported scopes and malformed stable client keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    assert.throws(() => service.pair('123456', '外部软件', { scopes: ['admin'] }), /权限无效/);
    assert.throws(() => service.pair('123456', '外部软件', { scopes: [VELA_FULL_ACCESS_SCOPE] }), /全权限连接/);
    assert.throws(() => service.pair('123456', '外部软件', { clientKey: '../escape' }), /标识无效/);
    assert.deepEqual(service.listClients(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pairing capacity fails closed without evicting an existing client', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const issued = Array.from({ length: 24 }, (_, index) => service.pair('123456', `素材软件 ${index + 1}`, {
      clientKey: `materials-client-${index + 1}`,
      scopes: [MATERIALS_READ_SCOPE]
    }));
    assert.equal(service.listClients().length, 24);
    assert.throws(() => service.pair('123456', '第 25 个素材软件', {
      clientKey: 'materials-client-25',
      scopes: [MATERIALS_READ_SCOPE]
    }), /24 个外部软件连接上限/);
    assert.equal(service.listClients().length, 24);
    assert.equal(service.verify(issued[0].token), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('browser origin policy allows Vela itself and native clients but blocks foreign pages', () => {
  const request = (headers) => ({
    headers,
    get: (name) => headers[String(name).toLowerCase()]
  });
  assert.equal(isTrustedVelaRequestOrigin(request({ host: '127.0.0.1:65432' })), true);
  assert.equal(isTrustedVelaRequestOrigin(request({
    host: '127.0.0.1:65432',
    origin: 'http://127.0.0.1:65432',
    'sec-fetch-site': 'same-origin'
  })), true);
  assert.equal(isTrustedVelaRequestOrigin(request({
    host: '127.0.0.1:65432',
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site'
  })), false);
  assert.equal(isTrustedVelaRequestOrigin(request({
    host: '127.0.0.1:65432',
    origin: 'http://127.0.0.1:5173',
    'sec-fetch-site': 'same-site'
  }), ['http://127.0.0.1:5173']), true);
  assert.equal(isTrustedVelaRequestOrigin(request({
    host: 'evil.example',
    origin: 'http://evil.example',
    'sec-fetch-site': 'same-origin'
  })), false);
  assert.equal(isTrustedVelaRequestOrigin(request({
    host: '127.0.0.1:65432',
    'sec-fetch-site': 'cross-site'
  })), false);
});

test('LAN pairing accepts only an explicit read-only material scope', () => {
  assert.equal(isValidRemotePairingScopes(undefined), false);
  assert.equal(isValidRemotePairingScopes([]), false);
  assert.equal(isValidRemotePairingScopes([VELA_FULL_ACCESS_SCOPE]), false);
  assert.equal(isValidRemotePairingScopes([MATERIALS_READ_SCOPE, VELA_FULL_ACCESS_SCOPE]), false);
  assert.equal(isValidRemotePairingScopes([MATERIALS_READ_SCOPE]), true);
});

test('LAN pairing failures are rate limited per remote address and recover after the block', () => {
  let currentTime = 1_000;
  const limiter = createRemotePairingAttemptLimiter({
    now: () => currentTime,
    maxFailures: 3,
    windowMs: 1_000,
    blockMs: 5_000
  });
  assert.deepEqual(limiter.check('192.168.1.20'), { allowed: true, retryAfterMs: 0 });
  assert.equal(limiter.recordFailure('192.168.1.20').allowed, true);
  assert.equal(limiter.recordFailure('192.168.1.20').allowed, true);
  assert.deepEqual(limiter.recordFailure('192.168.1.20'), { allowed: false, retryAfterMs: 5_000 });
  assert.equal(limiter.check('192.168.1.21').allowed, true);
  currentTime += 5_001;
  assert.deepEqual(limiter.check('192.168.1.20'), { allowed: true, retryAfterMs: 0 });
  limiter.recordFailure('192.168.1.20');
  limiter.recordSuccess('192.168.1.20');
  assert.deepEqual(limiter.check('192.168.1.20'), { allowed: true, retryAfterMs: 0 });
});

test('a corrupt primary connection store recovers from backup without losing clients', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const paired = service.pair('123456', 'Storyworks test');
    const storePath = path.join(directory, 'storyworks-connections.json');
    const backupPath = `${storePath}.bak`;
    assert.equal(JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(backupPath, 'utf8'))).clients.length, 1);

    await import('node:fs/promises').then(({ writeFile }) => writeFile(storePath, '{broken-json', 'utf8'));
    const recovered = createPairingService({ dataDirectory: directory, codeFactory: () => '654321', now: () => 42 });
    assert.equal(recovered.verify(paired.token), true);
    assert.equal(recovered.listClients().length, 1);
    assert.equal(JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(storePath, 'utf8'))).clients.length, 1);
    assert.equal((await import('node:fs/promises').then(({ readdir }) => readdir(directory)))
      .some((name) => name.startsWith('storyworks-connections.json.corrupt-42-')), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupt connection state without a valid backup fails closed and is never overwritten', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const fsPromises = await import('node:fs/promises');
    const storePath = path.join(directory, 'storyworks-connections.json');
    const backupPath = `${storePath}.bak`;
    await fsPromises.writeFile(storePath, '{primary-broken', 'utf8');
    await fsPromises.writeFile(backupPath, '{backup-broken', 'utf8');
    assert.throws(() => createPairingService({ dataDirectory: directory }), /已损坏且无法从备份恢复/);
    assert.equal(await fsPromises.readFile(storePath, 'utf8'), '{primary-broken');
    assert.equal(await fsPromises.readFile(backupPath, 'utf8'), '{backup-broken');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed pairing disk commit keeps the previously valid token active in memory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  try {
    const service = createPairingService({ dataDirectory: directory, codeFactory: () => '123456' });
    const first = service.pair('123456', '小红书素材盘', {
      clientKey: 'xhs-materials', scopes: [MATERIALS_READ_SCOPE]
    });
    const backupPath = path.join(directory, 'storyworks-connections.json.bak');
    await rm(backupPath, { force: true });
    await import('node:fs/promises').then(({ mkdir }) => mkdir(backupPath));

    assert.throws(() => service.pair('123456', '小红书素材盘', {
      clientKey: 'xhs-materials', scopes: [MATERIALS_READ_SCOPE]
    }));
    assert.equal(service.verify(first.token), true);
    assert.equal(service.listClients().length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('materials read route policy is deny-by-default', () => {
  assert.equal(isMaterialsReadOnlyClient({ scopes: [MATERIALS_READ_SCOPE] }), true);
  assert.equal(isMaterialsReadOnlyClient({ scopes: [VELA_FULL_ACCESS_SCOPE] }), false);
  assert.equal(isMaterialsReadRouteAllowed('GET', '/capabilities'), true);
  assert.equal(isMaterialsReadRouteAllowed('GET', '/sync-inbox'), true);
  assert.equal(isMaterialsReadRouteAllowed('POST', '/sync-inbox/batch-1/ack'), true);
  assert.equal(isMaterialsReadRouteAllowed('GET', '/batches/batch-1/sync-manifest'), true);
  assert.equal(isMaterialsReadRouteAllowed('GET', '/projects/project-1/media/media-1/file'), true);
  assert.equal(isMaterialsReadRouteAllowed('GET', '/batches'), false);
  assert.equal(isMaterialsReadRouteAllowed('POST', '/generate-image'), false);
  assert.equal(isMaterialsReadRouteAllowed('POST', '/generate-video'), false);
});

test('expired or incorrect pairing codes are rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-pairing-'));
  let current = 1_000;
  try {
    const service = createPairingService({ dataDirectory: directory, now: () => current, codeFactory: () => current === 1_000 ? '111111' : '222222' });
    assert.throws(() => service.pair('000000'), /无效或已过期/);
    current += 31 * 60 * 1000;
    assert.equal(service.info().pairingCode, '222222');
    assert.throws(() => service.pair('111111'), /无效或已过期/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
