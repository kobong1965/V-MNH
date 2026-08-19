import assert from 'node:assert/strict';
import test from 'node:test';

import { AutoDlPowerError, AutoDlPowerProvider } from './autodlPowerProvider.js';

const profile = (patch = {}) => ({
  id: 'autodl-pro-profile',
  autodlInstanceUuid: 'pro-76576c61fdf1',
  sshStartScript: '/root/autodl-tmp/vela-h3/deploy/start-comfy.sh',
  timeoutMs: 1_000,
  powerOnTimeoutMs: 5_000,
  ...patch
});

const secret = { autodlDeveloperToken: 'developer-token-never-log' };

test('AutoDL provider uses the documented status, power-on and power-off requests', async () => {
  const calls = [];
  const provider = new AutoDlPowerProvider({
    requestImpl: async (url, options) => {
      calls.push({ url, ...options });
      return { status: 200, body: { code: 'Success', data: new URL(url).pathname.endsWith('/status') ? 'running' : null } };
    }
  });

  assert.equal(await provider.getStatus(profile(), secret), 'running');
  await provider.powerOn(profile(), secret);
  await provider.powerOff(profile(), secret);

  assert.deepEqual(calls.map((call) => [call.method, new URL(call.url).pathname]), [
    ['GET', '/api/v1/dev/instance/pro/status'],
    ['POST', '/api/v1/dev/instance/pro/power_on'],
    ['POST', '/api/v1/dev/instance/pro/power_off']
  ]);
  assert.equal(calls[0].headers.Authorization, secret.autodlDeveloperToken);
  assert.equal(new URL(calls[0].url).searchParams.get('instance_uuid'), profile().autodlInstanceUuid);
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(calls[1].body, {
    instance_uuid: profile().autodlInstanceUuid,
    payload: 'gpu',
    start_command: `bash ${profile().sshStartScript}`
  });
  assert.deepEqual(calls[2].body, { instance_uuid: profile().autodlInstanceUuid });
});

test('AutoDL provider reads wallet balance and the private Pro image repository', async () => {
  const calls = [];
  const provider = new AutoDlPowerProvider({
    requestImpl: async (url, options) => {
      calls.push({ url, ...options });
      const pathname = new URL(url).pathname;
      return pathname.endsWith('/wallet/balance')
        ? { status: 200, body: { code: 'Success', data: { assets: 123450, accumulate: 500000, voucher_balance: 10000 } } }
        : {
          status: 200,
          body: {
            code: 'Success',
            data: {
              list: [{ image_uuid: 'image-vela', name: 'Vela H3', status: 'finished', image_size: 1024, create_at: '2026-08-19T10:00:00+08:00' }],
              result_total: 1,
              page_index: 1,
              page_size: 12
            }
          }
        };
    }
  });

  assert.deepEqual(await provider.getWalletBalance(profile(), secret), {
    assets: 123450,
    accumulate: 500000,
    voucher_balance: 10000
  });
  const repository = await provider.listPrivateImages(profile(), secret, { pageSize: 12 });
  assert.equal(repository.result_total, 1);
  assert.equal(repository.list[0].image_uuid, 'image-vela');
  assert.deepEqual(calls.map((call) => [call.method, new URL(call.url).pathname, call.body]), [
    ['POST', '/api/v1/dev/wallet/balance', undefined],
    ['POST', '/api/v1/dev/instance/pro/image/private/list', { page_index: 1, page_size: 12 }]
  ]);
  assert.equal(calls[0].headers.Authorization, secret.autodlDeveloperToken);
});

test('AutoDL provider rejects non-Pro UUID and missing tokens before sending a request', async () => {
  let calls = 0;
  const provider = new AutoDlPowerProvider({ requestImpl: async () => { calls += 1; } });
  await assert.rejects(() => provider.getStatus(profile({ autodlInstanceUuid: '14ff4b9f2b-74ac3ead' }), secret), (error) => {
    assert.equal(error.code, 'AUTODL_INSTANCE_INVALID');
    return true;
  });
  await assert.rejects(() => provider.getStatus(profile(), {}), (error) => {
    assert.equal(error.code, 'AUTODL_TOKEN_MISSING');
    return true;
  });
  assert.equal(calls, 0);
});

test('AutoDL authentication and network errors never leak the developer token', async () => {
  const rejected = new AutoDlPowerProvider({
    requestImpl: async () => ({ status: 401, body: { code: 'Failed', msg: `bad ${secret.autodlDeveloperToken}` } })
  });
  await assert.rejects(() => rejected.getStatus(profile(), secret), (error) => {
    assert.equal(error.code, 'AUTODL_AUTH_FAILED');
    assert.doesNotMatch(error.message, /developer-token-never-log/);
    return true;
  });

  const network = new AutoDlPowerProvider({
    requestImpl: async () => { throw new Error(`Bearer ${secret.autodlDeveloperToken}`); }
  });
  await assert.rejects(() => network.getStatus(profile(), secret), (error) => {
    assert.ok(error instanceof AutoDlPowerError);
    assert.equal(error.code, 'AUTODL_NETWORK_ERROR');
    assert.doesNotMatch(error.message, /developer-token-never-log/);
    return true;
  });
});

test('waitForState polls the same instance until it becomes running', async () => {
  const states = ['stopped', 'starting', 'running'];
  const provider = new AutoDlPowerProvider({
    pollIntervalMs: 1,
    sleep: async () => {},
    requestImpl: async () => ({ status: 200, body: { code: 'Success', data: states.shift() || 'running' } })
  });
  assert.equal(await provider.waitForState(profile(), secret, ['running']), 'running');
  assert.equal(states.length, 0);
});
