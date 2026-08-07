import assert from 'node:assert/strict';
import test from 'node:test';

import { ConnectionScheduler } from './scheduler.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('same connection respects its limit while different connections run in parallel', async () => {
  const releases = [];
  const active = new Map();
  const maximum = new Map();
  const scheduler = new ConnectionScheduler({
    executor: (job) => new Promise((resolve) => {
      const count = (active.get(job.profileId) || 0) + 1;
      active.set(job.profileId, count);
      maximum.set(job.profileId, Math.max(maximum.get(job.profileId) || 0, count));
      releases.push(() => {
        active.set(job.profileId, active.get(job.profileId) - 1);
        resolve();
      });
    })
  });
  scheduler.configureConnection('a', { maxConcurrency: 1, online: true });
  scheduler.configureConnection('b', { maxConcurrency: 2, online: true });
  for (let index = 0; index < 3; index += 1) scheduler.enqueue({ id: `a${index}`, profileId: 'a' });
  for (let index = 0; index < 3; index += 1) scheduler.enqueue({ id: `b${index}`, profileId: 'b' });
  await nextTurn();
  assert.equal(active.get('a'), 1);
  assert.equal(active.get('b'), 2);
  while (!scheduler.isIdle()) {
    const release = releases.shift();
    if (release) release();
    await nextTurn();
  }
  assert.equal(maximum.get('a'), 1);
  assert.equal(maximum.get('b'), 2);
});

test('offline connection retains queue until explicitly brought online', async () => {
  const executed = [];
  const scheduler = new ConnectionScheduler({ executor: async (job) => executed.push(job.id) });
  scheduler.configureConnection('cloud', { online: false });
  scheduler.enqueue({ id: 'job-1', profileId: 'cloud' });
  await nextTurn();
  assert.deepEqual(executed, []);
  assert.equal(scheduler.getSummary('cloud').queued, 1);
  scheduler.configureConnection('cloud', { online: true });
  await scheduler.waitForIdle();
  assert.deepEqual(executed, ['job-1']);
});
