import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudPowerManager } from './cloudPowerManager.js';

const makeProfile = (patch = {}) => ({
  id: 'autodl-pro',
  type: 'comfy',
  platform: 'autodl',
  autoPowerEnabled: true,
  autoPowerProvider: 'autodl-pro',
  autodlInstanceUuid: 'pro-76576c61fdf1',
  idleShutdownMinutes: 5,
  powerOnTimeoutMs: 600_000,
  secret: { autodlDeveloperToken: 'token' },
  ...patch
});

test('concurrent jobs share one AutoDL wake operation', async () => {
  const calls = [];
  const states = ['stopped', 'running'];
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => { calls.push('status'); return states.shift() || 'running'; },
      powerOn: async () => { calls.push('power-on'); },
      waitForState: async () => { calls.push('wait-running'); return 'running'; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => [{ status: 'queued' }],
    getRemoteQueue: async () => ({ running: 0, pending: 0 })
  });

  const [first, second] = await Promise.all([manager.ensureReady('autodl-pro'), manager.ensureReady('autodl-pro')]);
  assert.equal(first.state, 'running');
  assert.equal(second.state, 'running');
  assert.equal(calls.filter((call) => call === 'power-on').length, 1);
  assert.equal(calls.filter((call) => call === 'wait-running').length, 1);
});

test('idle shutdown verifies both local and remote queues twice before one power-off', async () => {
  let timerCallback;
  let timerDelay;
  let powerOffCalls = 0;
  let remoteChecks = 0;
  const jobs = [];
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => 'running',
      powerOff: async () => { powerOffCalls += 1; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => jobs,
    getRemoteQueue: async () => { remoteChecks += 1; return { running: 0, pending: 0 }; },
    setTimer: (callback, delayMs) => { timerCallback = callback; timerDelay = delayMs; return 1; },
    clearTimer: () => {},
    sleep: async () => {},
    idleConfirmationDelayMs: 1
  });

  assert.equal(manager.scheduleIdleShutdown('autodl-pro'), true);
  assert.equal(timerDelay, 5 * 60_000);
  await timerCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(remoteChecks, 2);
  assert.equal(powerOffCalls, 1);
  assert.equal(manager.getState('autodl-pro').state, 'stopped');
});

test('new work cancels an idle timer and prevents power-off', () => {
  let cleared = 0;
  let callback;
  const manager = new CloudPowerManager({
    powerProvider: {},
    getProfile: () => makeProfile(),
    listJobs: () => [],
    getRemoteQueue: async () => ({ running: 0, pending: 0 }),
    setTimer: (value) => { callback = value; return 9; },
    clearTimer: (handle) => { assert.equal(handle, 9); cleared += 1; }
  });

  manager.scheduleIdleShutdown('autodl-pro');
  manager.noteWorkStarted('autodl-pro');
  assert.equal(cleared, 1);
  assert.equal(manager.getState('autodl-pro').state, 'idle-shutdown-cancelled');
  assert.equal(typeof callback, 'function');
});

test('an explicit work lease blocks shutdown even if persisted job state is momentarily stale', async () => {
  let powerOffCalls = 0;
  let remoteChecks = 0;
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => 'running',
      powerOff: async () => { powerOffCalls += 1; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => [],
    getRemoteQueue: async () => { remoteChecks += 1; return { running: 0, pending: 0 }; }
  });

  manager.noteWorkStarted('autodl-pro', 'job-1');
  assert.deepEqual(await manager.powerOffIfStillIdle('autodl-pro'), { poweredOff: false, reason: 'local-work' });
  assert.equal(remoteChecks, 0);
  assert.equal(powerOffCalls, 0);

  manager.noteWorkFinished('autodl-pro', 'job-1');
  assert.equal(manager.hasLocalWork('autodl-pro'), false);
});

test('remote ComfyUI work blocks power-off even when local jobs are idle', async () => {
  let powerOffCalls = 0;
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => 'running',
      powerOff: async () => { powerOffCalls += 1; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => [],
    getRemoteQueue: async () => ({ running: 1, pending: 0 })
  });
  const result = await manager.powerOffIfStillIdle('autodl-pro');
  assert.equal(result.reason, 'remote-work');
  assert.equal(powerOffCalls, 0);
  assert.equal(manager.getState('autodl-pro').state, 'idle-countdown');
  manager.close();
});

test('application shutdown powers off even when local and remote work are still marked active', async () => {
  let powerOffCalls = 0;
  let remoteChecks = 0;
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => 'running',
      powerOff: async () => { powerOffCalls += 1; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => [{ status: 'running' }],
    getRemoteQueue: async () => { remoteChecks += 1; return { running: 1, pending: 2 }; }
  });

  manager.noteWorkStarted('autodl-pro', 'job-1');
  assert.deepEqual(
    await manager.forcePowerOff('autodl-pro', { reason: 'application-shutdown' }),
    { poweredOff: true, reason: 'application-shutdown' }
  );
  assert.equal(powerOffCalls, 1);
  assert.equal(remoteChecks, 0);
  assert.equal(manager.hasLocalWork('autodl-pro'), true);
  assert.equal(manager.getState('autodl-pro').state, 'stopped');
});

test('application shutdown does not send a duplicate power-off for an already stopped instance', async () => {
  let powerOffCalls = 0;
  const manager = new CloudPowerManager({
    powerProvider: {
      getStatus: async () => 'shutdown',
      powerOff: async () => { powerOffCalls += 1; }
    },
    getProfile: () => makeProfile(),
    listJobs: () => [],
    getRemoteQueue: async () => ({ running: 0, pending: 0 })
  });

  assert.deepEqual(await manager.forcePowerOff('autodl-pro'), { poweredOff: false, reason: 'already-stopped' });
  assert.equal(powerOffCalls, 0);
});

test('disabled profiles are never managed', async () => {
  const manager = new CloudPowerManager({
    powerProvider: {},
    getProfile: () => makeProfile({ autoPowerEnabled: false }),
    listJobs: () => [],
    getRemoteQueue: async () => ({ running: 0, pending: 0 })
  });
  assert.deepEqual(await manager.ensureReady('autodl-pro'), { enabled: false, state: 'unmanaged' });
  assert.equal(manager.scheduleIdleShutdown('autodl-pro'), false);
});
