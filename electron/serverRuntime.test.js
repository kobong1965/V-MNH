import assert from 'node:assert/strict';
import test from 'node:test';

import { findAvailablePort, waitForHealth } from './serverRuntime.js';

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
