import assert from 'node:assert/strict';
import test from 'node:test';

import { VelaDatabase } from './database.js';
import { getShanghaiDayWindow, H3UsageAnalytics } from './h3UsageAnalytics.js';

const insertJob = (database, {
  id,
  status,
  resolution,
  acceleration,
  duration,
  createdAt,
  transitions
}) => {
  const groupId = `group-${id}`;
  database.connection.prepare(`
    INSERT INTO job_groups(id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed, total_count, created_at, updated_at)
    VALUES (?, 'project', 'node', 'comfy', 'profile-h3', 'fixed', 1, 1, ?, ?)
  `).run(groupId, createdAt, createdAt);
  database.connection.prepare(`
    INSERT INTO jobs(id, group_id, project_id, node_id, provider_type, profile_id, status, payload_json, seed, retry_count, priority, created_at, updated_at)
    VALUES (?, ?, 'project', 'node', 'comfy', 'profile-h3', ?, ?, 1, 0, 0, ?, ?)
  `).run(id, groupId, status, JSON.stringify({
    nodeKind: 'h3-video', resolution, duration, h3Acceleration: acceleration
  }), createdAt, transitions.at(-1)?.at || createdAt);
  const statement = database.connection.prepare(`
    INSERT INTO job_events(job_id, event_type, data_json, created_at)
    VALUES (?, 'status-changed', ?, ?)
  `);
  for (const transition of transitions) statement.run(id, JSON.stringify(transition.data), transition.at);
};

test('H3 usage analytics groups successful, failed and running GPU cost by resolution and preset', () => {
  const database = new VelaDatabase(':memory:');
  try {
    insertJob(database, {
      id: 'success-720', status: 'succeeded', resolution: '720p', acceleration: 'turbo-8', duration: 15,
      createdAt: '2026-08-19T01:00:00.000Z',
      transitions: [
        { data: { from: 'queued', to: 'running' }, at: '2026-08-19T01:00:10.000Z' },
        { data: { from: 'running', to: 'downloading' }, at: '2026-08-19T01:06:10.000Z' },
        { data: { from: 'downloading', to: 'succeeded' }, at: '2026-08-19T01:06:12.000Z' }
      ]
    });
    insertJob(database, {
      id: 'failed-1080', status: 'failed', resolution: '1080p', acceleration: 'standard', duration: 5,
      createdAt: '2026-08-19T02:00:00.000Z',
      transitions: [
        { data: { from: 'queued', to: 'running' }, at: '2026-08-19T02:00:00.000Z' },
        { data: { from: 'running', to: 'failed' }, at: '2026-08-19T02:02:00.000Z' }
      ]
    });
    insertJob(database, {
      id: 'running-2k', status: 'running', resolution: '2K', acceleration: 'turbo-4', duration: 10,
      createdAt: '2026-08-19T03:00:00.000Z',
      transitions: [
        { data: { from: 'queued', to: 'running' }, at: '2026-08-19T03:00:30.000Z' }
      ]
    });

    const analytics = new H3UsageAnalytics(database);
    const result = analytics.getDailySummary({
      from: '2026-08-18T16:00:00.000Z',
      to: '2026-08-19T16:00:00.000Z',
      now: '2026-08-19T03:01:30.000Z',
      profileId: 'profile-h3',
      hourlyRateYuan: 7.97
    });

    assert.deepEqual(result.summary, {
      successfulVideos: 1,
      failedVideos: 1,
      activeVideos: 1,
      generatedSeconds: 15,
      gpuSeconds: 540,
      estimatedCostYuan: 1.2,
      successfulCostYuan: 0.8,
      failedCostYuan: 0.27,
      activeCostYuan: 0.13
    });
    assert.deepEqual(result.byResolution.find((item) => item.key === '720p'), {
      key: '720p', successfulVideos: 1, failedVideos: 0, activeVideos: 0,
      generatedSeconds: 15, gpuSeconds: 360, estimatedCostYuan: 0.8
    });
    assert.equal(result.byResolution.find((item) => item.key === '1080p').failedVideos, 1);
    assert.equal(result.byResolution.find((item) => item.key === '2K').activeVideos, 1);
    assert.equal(result.byPreset.find((item) => item.key === 'standard').estimatedCostYuan, 0.27);
  } finally {
    database.close();
  }
});

test('Shanghai day window uses a stable UTC+8 boundary', () => {
  assert.deepEqual(getShanghaiDayWindow({ now: new Date('2026-08-19T15:59:59.000Z') }), {
    dateKey: '2026-08-19',
    timezone: 'Asia/Shanghai',
    from: '2026-08-18T16:00:00.000Z',
    to: '2026-08-19T16:00:00.000Z'
  });
  assert.equal(getShanghaiDayWindow({ now: new Date('2026-08-19T16:00:00.000Z') }).dateKey, '2026-08-20');
});
