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

test('AutoDL provider saves an image and creates one PRO6000 instance from it', async () => {
  const calls = [];
  const provider = new AutoDlPowerProvider({
    requestImpl: async (url, options) => {
      calls.push({ url, ...options });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/snapshot')) {
        return { status: 200, body: { code: 'Success', data: { expand_system_disk_size: 214748364800 } } };
      }
      if (pathname.endsWith('/image/save')) {
        return { status: 200, body: { code: 'Success', data: { image_uuid: 'image-vela-h3' } } };
      }
      if (pathname.endsWith('/pro/list')) {
        return { status: 200, body: { code: 'Success', data: { list: [], result_total: 0 } } };
      }
      return { status: 200, body: { code: 'Success', data: 'pro-secondgpu' } };
    }
  });

  const snapshot = await provider.getSnapshot(profile(), secret);
  const saved = await provider.savePrivateImage(profile(), secret, { imageName: 'Vela MiniMax H3 20260820' });
  const instances = await provider.listInstances(profile(), secret, { pageSize: 50 });
  const created = await provider.createInstance(profile(), secret, {
    imageUuid: saved.image_uuid,
    instanceName: 'Vela MiniMax H3 GPU 2',
    expandSystemDiskByGb: 200,
    startCommand: 'bash /root/autodl-tmp/vela-h3/deploy/start-comfy.sh'
  });

  assert.equal(snapshot.expand_system_disk_size, 214748364800);
  assert.equal(instances.result_total, 0);
  assert.equal(created, 'pro-secondgpu');
  assert.deepEqual(calls.map((call) => [call.method, new URL(call.url).pathname]), [
    ['GET', '/api/v1/dev/instance/pro/snapshot'],
    ['POST', '/api/v1/dev/instance/pro/image/save'],
    ['POST', '/api/v1/dev/instance/pro/list'],
    ['POST', '/api/v1/dev/instance/pro/create']
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get('instance_uuid'), profile().autodlInstanceUuid);
  assert.deepEqual(calls[1].body, {
    instance_uuid: profile().autodlInstanceUuid,
    image_name: 'Vela MiniMax H3 20260820'
  });
  assert.deepEqual(calls[2].body, { page_index: 1, page_size: 50 });
  assert.deepEqual(calls[3].body, {
    req_gpu_amount: 1,
    expand_system_disk_by_gb: 200,
    gpu_spec_uuid: 'pro6000-p',
    image_uuid: 'image-vela-h3',
    cuda_v_from: 128,
    instance_name: 'Vela MiniMax H3 GPU 2',
    start_command: 'bash /root/autodl-tmp/vela-h3/deploy/start-comfy.sh'
  });
});

test('AutoDL provider rejects unsafe image and GPU identifiers before creating an instance', async () => {
  let calls = 0;
  const provider = new AutoDlPowerProvider({ requestImpl: async () => { calls += 1; } });
  await assert.rejects(
    () => provider.createInstance(profile(), secret, { imageUuid: 'not-an-image' }),
    (error) => error.code === 'AUTODL_IMAGE_INVALID'
  );
  await assert.rejects(
    () => provider.createInstance(profile(), secret, { imageUuid: 'image-safe', gpuSpecUuid: 'bad spec' }),
    (error) => error.code === 'AUTODL_GPU_SPEC_INVALID'
  );
  await assert.rejects(
    () => provider.savePrivateImage(profile(), secret, { imageName: '' }),
    (error) => error.code === 'AUTODL_IMAGE_NAME_INVALID'
  );
  assert.equal(calls, 0);
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

test('AutoDL provider retries rate-limited requests with exponential backoff', async () => {
  let requests = 0;
  const sleeps = [];
  const provider = new AutoDlPowerProvider({
    rateLimitRetries: 4,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    requestImpl: async () => {
      requests += 1;
      if (requests < 3) {
        return { status: 429, body: { code: 'Failed', msg: '请求过于频繁' } };
      }
      return { status: 200, body: { code: 'Success', data: 'running' } };
    }
  });

  assert.equal(await provider.getStatus(profile(), secret), 'running');
  assert.equal(requests, 3);
  assert.deepEqual(sleeps, [750, 1_500]);
});

test('AutoDL provider serializes concurrent account-control requests', async () => {
  let active = 0;
  let maximumActive = 0;
  const provider = new AutoDlPowerProvider({
    requestImpl: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { status: 200, body: { code: 'Success', data: 'running' } };
    }
  });

  await Promise.all([
    provider.getStatus(profile(), secret),
    provider.getStatus(profile({ autodlInstanceUuid: 'pro-secondgpu' }), secret)
  ]);
  assert.equal(maximumActive, 1);
});
