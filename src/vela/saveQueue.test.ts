import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoalescingSaveQueue } from './saveQueue.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test('a save requested while another save is running is persisted immediately afterwards', async () => {
  const first = deferred();
  const snapshots: string[] = [];
  let currentSnapshot = 'A';
  const queue = createCoalescingSaveQueue({
    getSave: () => async () => {
      snapshots.push(currentSnapshot);
      if (snapshots.length === 1) await first.promise;
    }
  });

  const firstRequest = queue.request();
  currentSnapshot = 'B';
  const secondRequest = queue.request();
  assert.deepEqual(snapshots, ['A']);

  first.resolve();
  await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(snapshots, ['A', 'B']);
});

test('multiple overlapping save requests coalesce into one latest follow-up save', async () => {
  const first = deferred();
  let calls = 0;
  const queue = createCoalescingSaveQueue({
    getSave: () => async () => {
      calls += 1;
      if (calls === 1) await first.promise;
    }
  });

  const firstRequest = queue.request();
  const overlappingRequests = [queue.request(), queue.request(), queue.request()];
  first.resolve();
  await Promise.all([firstRequest, ...overlappingRequests]);
  assert.equal(calls, 2);
});

test('an older failed save does not override a newer successful queued save', async () => {
  const first = deferred();
  let calls = 0;
  const queue = createCoalescingSaveQueue({
    getSave: () => async () => {
      calls += 1;
      if (calls === 1) {
        await first.promise;
        throw new Error('older save failed');
      }
    }
  });

  const firstRequest = queue.request();
  const latestRequest = queue.request();
  first.resolve();
  await Promise.all([firstRequest, latestRequest]);
  assert.equal(calls, 2);
});
