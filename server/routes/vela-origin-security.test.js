import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testRoot = process.platform === 'win32'
  ? 'E:\\Codex工作盘\\temp'
  : os.tmpdir();

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForServer = async (baseUrl, child) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vela test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/vela/health`);
      if (response.ok) return;
    } catch { /* startup is still in progress */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Vela test server did not start');
};

const requestWithBody = (url, { method = 'GET', headers = {}, body = '{}' } = {}) => new Promise((resolve, reject) => {
  const request = http.request(url, { method, headers }, (response) => {
    response.resume();
    response.once('end', () => resolve(response.statusCode));
  });
  request.once('error', reject);
  request.end(body);
});

test('the real Vela server blocks foreign browser origins before connection and job routes', async () => {
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'vela-origin-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      VELA_DATA_DIR: path.join(directory, 'data'),
      VELA_PROJECTS_DIR: path.join(directory, 'projects'),
      VELA_LIBRARY_DIR: path.join(directory, 'library')
    }
  });
  try {
    await waitForServer(baseUrl, child);
    for (const request of [
      fetch(`${baseUrl}/api/vela/connection`, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }),
      fetch(`${baseUrl}/api/vela/connection/pair`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        // Malformed JSON proves the origin guard runs before the body parser.
        body: '{'
      }),
      fetch(`${baseUrl}/api/vela/jobs`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        body: '{}'
      })
    ]) {
      assert.equal((await request).status, 403);
    }
    assert.equal((await fetch(`${baseUrl}/api/vela/connection`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/vela/connection`, {
      headers: { origin: baseUrl, 'sec-fetch-site': 'same-origin' }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/vela/connection`, {
      headers: { origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-site' }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/vela/connection/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000', padding: 'x'.repeat(70 * 1024) })
    })).status, 413);
    assert.equal(await requestWithBody(`${baseUrl}/api/vela/health`, {
      headers: { 'content-type': 'application/json', 'content-length': '2' }
    }), 413);
    assert.equal(await requestWithBody(`${baseUrl}/api/vela/health`, {
      headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }
    }), 413);
    assert.equal(await requestWithBody(`${baseUrl}/api/vela/health`, {
      method: 'HEAD',
      headers: { 'content-type': 'application/json', 'content-length': '2' }
    }), 413);

    const connection = await (await fetch(`${baseUrl}/api/vela/connection`)).json();
    const pairingResponse = await fetch(`${baseUrl}/api/vela/connection/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: connection.pairingCode,
        clientName: '最大确认清单测试',
        clientKey: 'max-ack-contract-test',
        scopes: ['materials:read']
      })
    });
    assert.equal(pairingResponse.status, 200);
    const paired = await pairingResponse.json();
    const maximumContractKeys = Array.from({ length: 1_000 }, (_, index) => (
      `k${String(index).padStart(4, '0')}${'x'.repeat(507)}`
    ));
    const ackResponse = await fetch(`${baseUrl}/api/vela/sync-inbox/missing-batch/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${paired.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ sourceKeys: maximumContractKeys })
    });
    assert.equal(ackResponse.status, 404);
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 5_000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the real LAN route rate limits repeated invalid pairing codes', async (context) => {
  const lanAddress = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
  if (!lanAddress) {
    context.skip('no non-loopback IPv4 interface is available');
    return;
  }
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'vela-lan-pairing-'));
  const port = await freePort();
  const loopbackBaseUrl = `http://127.0.0.1:${port}`;
  const lanBaseUrl = `http://${lanAddress}:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      VELA_LAN_ENABLED: 'true',
      VELA_DATA_DIR: path.join(directory, 'data'),
      VELA_PROJECTS_DIR: path.join(directory, 'projects'),
      VELA_LIBRARY_DIR: path.join(directory, 'library')
    }
  });
  try {
    await waitForServer(loopbackBaseUrl, child);
    const connection = await (await fetch(`${loopbackBaseUrl}/api/vela/connection`)).json();
    const legacyPairingResponse = await fetch(`${loopbackBaseUrl}/api/vela/connection/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: connection.pairingCode, clientName: '旧版全权限连接' })
    });
    assert.equal(legacyPairingResponse.status, 200);
    const legacyPairing = await legacyPairingResponse.json();
    assert.equal((await fetch(`${lanBaseUrl}/api/vela/jobs`, {
      headers: { authorization: `Bearer ${legacyPairing.accessToken}` }
    })).status, 403);
    const incorrectCode = connection.pairingCode === '000000' ? '000001' : '000000';
    const attempt = (code) => fetch(`${lanBaseUrl}/api/vela/connection/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        clientName: '局域网素材软件',
        clientKey: 'lan-materials-test',
        scopes: ['materials:read']
      })
    });
    const statuses = [];
    for (let index = 0; index < 6; index += 1) statuses.push((await attempt(incorrectCode)).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    const blockedCorrectAttempt = await attempt(connection.pairingCode);
    assert.equal(blockedCorrectAttempt.status, 429);
    assert.match(blockedCorrectAttempt.headers.get('retry-after') || '', /^\d+$/);
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 5_000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
