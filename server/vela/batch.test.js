import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeeds, expandJobGroup } from './batch.js';

const draft = (count, seedMode = 'increment') => ({
  projectId: 'project-1',
  nodeId: 'node-1',
  profileId: 'fake-local',
  providerType: 'fake',
  payload: { prompt: '产品展示' },
  count,
  seedMode,
  seed: 42
});

for (const count of [1, 4, 10, 50]) {
  test(`batch expansion creates ${count} independently traceable jobs`, () => {
    const expanded = expandJobGroup(draft(count));
    assert.equal(expanded.jobs.length, count);
    assert.equal(new Set(expanded.jobs.map((job) => job.id)).size, count);
    assert.equal(expanded.jobs.at(-1).payload.batchCount, count);
  });
}

test('seed modes are deterministic and reproducible', () => {
  assert.deepEqual(createSeeds({ count: 4, mode: 'fixed', baseSeed: 8 }), [8, 8, 8, 8]);
  assert.deepEqual(createSeeds({ count: 4, mode: 'increment', baseSeed: 8 }), [8, 9, 10, 11]);
  const first = createSeeds({ count: 10, mode: 'random', baseSeed: 2026 });
  const second = createSeeds({ count: 10, mode: 'random', baseSeed: 2026 });
  assert.deepEqual(first, second);
  assert.ok(new Set(first).size > 1);
});

test('batch expansion rejects requests above the first-version safety limit', () => {
  assert.throws(() => expandJobGroup(draft(51)), /1-50|between 1 and 50/);
});
