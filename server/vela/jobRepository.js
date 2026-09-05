import crypto from 'node:crypto';

import { assertJobTransition, getRestartRecoveryStatus } from './jobStateMachine.js';

const parseJson = (value) => value ? JSON.parse(value) : null;
const ACTIVE_JOB_STATUSES = Object.freeze(['queued', 'preparing', 'submitting', 'running', 'reconnecting', 'downloading']);
const ACTIVE_JOB_STATUS_PLACEHOLDERS = ACTIVE_JOB_STATUSES.map(() => '?').join(', ');

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

export class JobGroupContractConflictError extends Error {
  constructor(externalKey) {
    super(`External job contract conflicts with the existing group: ${externalKey}`);
    this.name = 'JobGroupContractConflictError';
    this.status = 409;
    this.code = 'JOB_CONTRACT_CONFLICT';
  }
}

export class JobRepository {
  constructor(database, { onEvent } = {}) {
    this.database = database;
    this.db = database.connection;
    this.onEvent = onEvent;
  }

  createGroup(group, jobs) {
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      this.insertGroupAndJobs(group, jobs, now);
      return this.getGroup(group.id);
    });
  }

  insertGroupAndJobs(group, jobs, now = new Date().toISOString()) {
    this.db.prepare(`
      INSERT INTO job_groups(
        id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed, total_count,
        external_key, contract_fingerprint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      group.id, group.projectId, group.nodeId, group.providerType, group.profileId,
      group.seedMode, group.baseSeed, jobs.length, group.externalKey || null,
      group.contractFingerprint || null, now, now
    );

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
  }

  createOrGetExternalGroup(group, jobs) {
    if (!group?.externalKey || !group?.contractFingerprint || jobs.length !== 1) {
      throw new Error('External job groups require one job, an external key, and a contract fingerprint');
    }
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM job_groups WHERE external_key = ?').get(group.externalKey);
      if (existing) {
        const conflicts = existing.contract_fingerprint !== group.contractFingerprint
          || existing.project_id !== group.projectId
          || existing.node_id !== group.nodeId
          || existing.provider_type !== group.providerType;
        if (conflicts) throw new JobGroupContractConflictError(group.externalKey);
        return {
          created: false,
          group: this.getGroup(existing.id),
          jobs: this.listJobs({ groupId: existing.id, limit: 1 })
        };
      }
      this.insertGroupAndJobs(group, jobs, now);
      return {
        created: true,
        group: this.getGroup(group.id),
        jobs: this.listJobs({ groupId: group.id, limit: 1 })
      };
    });
  }

  getGroupByExternalKey(externalKey) {
    const row = this.db.prepare('SELECT id FROM job_groups WHERE external_key = ?').get(externalKey);
    return row ? this.getGroup(row.id) : null;
  }

  getExternalGroupBundle(externalKey) {
    const group = this.getGroupByExternalKey(externalKey);
    if (!group) return null;
    const jobs = this.listJobs({ groupId: group.id, limit: 2 });
    if (jobs.length !== 1) throw new Error(`External job group ${group.id} does not contain exactly one job`);
    return { group, job: jobs[0] };
  }

  getJob(jobId) {
    return toJob(this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
  }

  findLatestNodeJob(projectId, nodeId) {
    return toJob(this.db.prepare(`
      SELECT * FROM jobs
      WHERE project_id = ? AND node_id = ?
      ORDER BY created_at DESC, updated_at DESC, rowid DESC
      LIMIT 1
    `).get(projectId, nodeId));
  }

  listJobs({ status, profileId, groupId, limit = 500, newestFirst = false } = {}) {
    const clauses = [];
    const values = [];
    if (status) { clauses.push('status = ?'); values.push(status); }
    if (profileId) { clauses.push('profile_id = ?'); values.push(profileId); }
    if (groupId) { clauses.push('group_id = ?'); values.push(groupId); }
    values.push(Math.max(1, Math.min(2000, Number(limit) || 500)));
    return this.db.prepare(`
      SELECT * FROM jobs
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY ${newestFirst ? 'updated_at DESC, created_at DESC' : 'priority DESC, created_at ASC'}
      LIMIT ?
    `).all(...values).map(toJob);
  }

  countActiveJobsForProject(projectId) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) return 0;
    return Number(this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE project_id = ? AND status IN (${ACTIVE_JOB_STATUS_PLACEHOLDERS})
    `).get(normalizedProjectId, ...ACTIVE_JOB_STATUSES).count) || 0;
  }

  getGroup(groupId) {
    const group = this.db.prepare('SELECT * FROM job_groups WHERE id = ?').get(groupId);
    if (!group) return null;
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'submission_uncertain' THEN 1 ELSE 0 END) AS submission_uncertain,
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
      externalKey: group.external_key || null,
      contractFingerprint: group.contract_fingerprint || null,
      totalCount: counts.total,
      succeededCount: counts.succeeded,
      failedCount: counts.failed,
      submissionUncertainCount: counts.submission_uncertain,
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
      promptId: patch.promptId === undefined ? current.promptId : patch.promptId,
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
    const completedComfyPrompt = current.providerType === 'comfy'
      && ['EXECUTION_FAILED', 'OUTPUT_NOT_FOUND'].includes(current.error?.code);
    return this.transition(jobId, 'queued', {
      retryCount: current.retryCount + 1,
      error: null,
      progress: 0,
      ...(completedComfyPrompt ? { promptId: null } : {})
    });
  }

  recoverAfterRestart() {
    const legacyUncertain = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'submission_uncertain'
      ORDER BY priority DESC, created_at ASC
    `).all().map(toJob);
    const recovered = legacyUncertain.map((job) => this.transition(job.id, 'failed', {
      error: {
        code: 'SUBMISSION_FAILED',
        message: '未获得生成结果，可直接重新发起。',
        retryable: true,
        safeToRetry: true,
        ...(job.error?.details ? { details: job.error.details } : {})
      }
    }));
    const recoverable = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('queued', 'preparing', 'submitting', 'running', 'reconnecting', 'downloading')
      ORDER BY priority DESC, created_at ASC
    `).all().map(toJob);

    for (const job of recoverable) {
      const current = this.getJob(job.id);
      if (!current) continue;
      const nextStatus = getRestartRecoveryStatus(current);
      if (nextStatus !== current.status) {
        recovered.push(this.transition(current.id, nextStatus, nextStatus === 'failed' ? {
          error: {
            code: 'SUBMISSION_INTERRUPTED',
            message: '上次提交中断且未获得生成结果，可直接重新发起。',
            retryable: true,
            safeToRetry: true
          }
        } : undefined));
      }
      else recovered.push(current);
    }
    return recovered;
  }
}
