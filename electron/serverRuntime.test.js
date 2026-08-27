import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildControlServiceArguments,
  findAvailablePort,
  getRuntimeDiscoveryUserDataDirectory,
  VELA_RUNTIME_DISCOVERY_FILE,
  waitForHealth,
  writeRuntimeDiscovery
} from './serverRuntime.js';

test('desktop runtime reserves an available localhost port', async () => {
  const port = await findAvailablePort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port <= 65535);
});

test('desktop runtime waits until the control service reports healthy', async () => {
  let calls = 0;
  const result = await waitForHealth('http://fixture.test', {
    attempts: 3,
    intervalMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 2) throw new Error('not ready');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(result, true);
  assert.equal(calls, 2);
});

test('desktop runtime passes explicit Unicode data paths to the control service', () => {
  const paths = {
    serverEntry: 'C:\\Program Files\\Vela\\server\\index.js',
    dataDirectory: 'C:\\Users\\Administrator\\AppData\\Roaming\\Vela AI视频画布\\data',
    projectsDirectory: 'C:\\Users\\Administrator\\Documents\\Vela Projects',
    libraryDirectory: 'C:\\Users\\Administrator\\AppData\\Roaming\\Vela AI视频画布\\library'
  };
  const argumentsList = buildControlServiceArguments(paths);

  assert.equal(argumentsList[0], paths.serverEntry);
  assert.equal(decodeURIComponent(argumentsList[1].split('=').slice(1).join('=')), paths.dataDirectory);
  assert.equal(decodeURIComponent(argumentsList[2].split('=').slice(1).join('=')), paths.projectsDirectory);
  assert.equal(decodeURIComponent(argumentsList[3].split('=').slice(1).join('=')), paths.libraryDirectory);
});

test('desktop child publishes discovery from its explicit data argument even without inherited environment variables', () => {
  const dataDirectory = 'C:\\Users\\Administrator\\AppData\\Roaming\\Vela AI视频画布\\data';
  assert.equal(
    getRuntimeDiscoveryUserDataDirectory({
      dataDirectory,
      processArguments: [
        'server/index.js',
        `--vela-data-dir=${encodeURIComponent(dataDirectory)}`
      ]
    }),
    path.dirname(path.resolve(dataDirectory))
  );
  assert.equal(
    getRuntimeDiscoveryUserDataDirectory({ dataDirectory, processArguments: ['server/index.js'] }),
    null
  );
});

test('desktop runtime publishes a stable localhost discovery document after startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-runtime-discovery-'));
  try {
    const payload = await writeRuntimeDiscovery({
      userDataDirectory: directory,
      baseUrl: 'http://127.0.0.1:65449/',
      pid: 4321,
      now: new Date('2026-08-21T10:00:00.000Z')
    });
    const saved = JSON.parse(await readFile(path.join(directory, VELA_RUNTIME_DISCOVERY_FILE), 'utf8'));
    assert.deepEqual(payload, saved);
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.service, 'vela-control');
    assert.equal(saved.baseUrl, 'http://127.0.0.1:65449');
    assert.equal(saved.pid, 4321);
    assert.equal(saved.updatedAt, '2026-08-21T10:00:00.000Z');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop runtime refuses to publish a non-local discovery address', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-runtime-discovery-'));
  try {
    await assert.rejects(
      writeRuntimeDiscovery({ userDataDirectory: directory, baseUrl: 'https://remote.example.com:65449' }),
      /localhost/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
