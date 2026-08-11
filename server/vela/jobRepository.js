import crypto from 'node:crypto';

import { assertJobTransition, getRestartRecoveryStatus } from './jobStateMachine.js';

const parseJson = (value) => value ? JSON.parse(value) : null;

const toJob = (row) => row ? ({
  id: row.id,
  groupId: row.group_id,
  projectId: row.project_id,
  nodeId: row.node_id,
  providerType: row.provider_type,
  profileId: row.profile_id,
  status: row.status,
  payload: parseJson(row.payload_json),
  progress: row.progress,
  seed: row.seed,
  retryCount: row.retry_count,
  promptId: row.prompt_id,
  workflowVersion: row.workflow_version,
  error: parseJson(row.error_json),
  output: parseJson(row.output_json),
  priority: row.priority,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;

export class JobRepository {
  constructor(database, { onEvent } = {}) {
    this.database = database;
    this.db = database.connection;
    this.onEvent = onEvent;
  }

  createGroup(group, jobs) {
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      this.db.prepare(`
        INSERT INTO job_groups(id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed, total_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(group.id, group.projectId, group.nodeId, group.providerType, group.profileId, group.seedMode, group.baseSeed, jobs.length, now, now);

      const insertJob = this.db.prepare(`
        INSERT INTO jobs(id, group_id, project_id, node_id, provider_type, profile_id, status, payload_json, seed, workflow_version, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
      `);
      for (const job of jobs) {
        insertJob.run(
          job.id,
          group.id,
          group.projectId,
          group.nodeId,
          group.providerType,
          group.profileId,
          JSON.stringify(job.payload),
          job.seed,
          job.workflowVersion || null,
          job.priority || 0,
          now,
          now
        );
      }
      return this.getGroup(group.id);
    });
  }

  getJob(jobId) {
    return toJob(this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
  }

  listJobs({ status, profileId, groupId, limit = 500 } = {}) {
    const clauses = [];
    const values = [];
    if (status) { clauses.push('status = ?'); values.push(status); }
    if (profileId) { clauses.push('profile_id = ?'); values.push(profileId); }
    if (groupId) { clauses.push('group_id = ?'); values.push(groupId); }
    values.push(Math.max(1, Math.min(2000, Number(limit) || 500)));
    return this.db.prepare(`
      SELECT * FROM jobs
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(...values).map(toJob);
  }

  getGroup(groupId) {
    const group = this.db.prepare('SELECT * FROM job_groups WHERE id = ?').get(groupId);
    if (!group) return null;
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM jobs WHERE group_id = ?
    `).get(groupId);
    return {
      id: group.id,
      projectId: group.project_id,
      nodeId: group.node_id,
      providerType: group.provider_type,
      profileId: group.profile_id,
      seedMode: group.seed_mode,
      baseSeed: group.base_seed,
      totalCount: counts.total,
      succeededCount: counts.succeeded,
      failedCount: counts.failed,
      cancelledCount: counts.cancelled,
      createdAt: group.created_at,
      updatedAt: group.updated_at
    };
  }

  transition(jobId, nextStatus, patch = {}) {
    const current = this.getJob(jobId);
    if (!current) throw new Error(`Job not found: ${jobId}`);
    assertJobTransition(current.status, nextStatus);
    const now = new Date().toISOString();
    const updated = {
      progress: patch.progress ?? current.progress,
      promptId: patch.promptId ?? current.promptId,
      error: patch.error === undefined ? current.error : patch.error,
      output: patch.output === undefined ? current.output : patch.output,
      retryCount: patch.retryCount ?? current.retryCount
    };
    this.database.transaction(() => {
      this.db.prepare(`
        UPDATE jobs SET status = ?, progress = ?, prompt_id = ?, error_json = ?, output_json = ?, retry_count = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        updated.progress,
        updated.promptId,
        updated.error ? JSON.stringify(updated.error) : null,
        updated.output ? JSON.stringify(updated.output) : null,
        updated.retryCount,
        now,
        jobId
      );
      this.db.prepare('UPDATE job_groups SET updated_at = ? WHERE id = ?').run(now, current.groupId);
      this.db.prepare('INSERT INTO job_events(job_id, event_type, data_json, created_at) VALUES (?, ?, ?, ?)')
        .run(jobId, 'status-changed', JSON.stringify({ from: current.status, to: nextStatus }), now);
    });
    const job = this.getJob(jobId);
    this.onEvent?.({ id: crypto.randomUUID(), type: 'job.updated', job, createdAt: now });
    return job;
  }

  updateProgress(jobId, progress) {
    const current = this.getJob(jobId);
    if (!current) throw new Error(`Job not found: ${jobId}`);
    const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.db.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?')
        .run(normalized, now, jobId);
      this.db.prepare('UPDATE job_groups SET updated_at = ? WHERE id = ?').run(now, current.groupId);
      this.db.prepare('INSERT INTO job_events(job_id, event_type, data_json, created_at) VALUES (?, ?, ?, ?)')
        .run(jobId, 'progress-updated', JSON.stringify({ progress: normalized }), now);
    });
    const job = this.getJob(jobId);
    this.onEvent?.({ id: crypto.randomUUID(), type: 'job.updated', job, createdAt: now });
    return job;
  }

  retry(jobId) {
    const current = this.getJob(jobId);
    if (!current) throw new Error(`Job not found: ${jobId}`);
    return this.transition(jobId, 'queued', { retryCount: current.retryCount + 1, error: null, progress: null });
  }

  recoverAfterRestart() {
    const recoverable = this.listJobs({ limit: 2000 })
      .filter((job) => ['queued', 'submitting', 'running', 'reconnecting', 'downloading'].includes(job.status));
    const recovered = [];
    for (const job of recoverable) {
      const nextStatus = getRestartRecoveryStatus(job);
      if (nextStatus !== job.status) recovered.push(this.transition(job.id, nextStatus));
      else recovered.push(job);
    }
    return recovered;
  }
}
