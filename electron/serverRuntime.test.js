import assert from 'node:assert/strict';
import test from 'node:test';

import { buildControlServiceArguments, findAvailablePort, waitForHealth } from './serverRuntime.js';

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
