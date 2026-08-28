import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VelaDatabase } from './database.js';
import { JobRepository } from './jobRepository.js';
import { assertJobTransition, canTransitionJob, getRestartRecoveryStatus } from './jobStateMachine.js';

const createQueuedJob = (repository) => repository.createGroup({
  id: 'group-1', projectId: 'project-1', nodeId: 'node-1', providerType: 'fake', profileId: 'local', seedMode: 'fixed', baseSeed: 7
}, [{ id: 'job-1', payload: { prompt: '测试' }, seed: 7 }]);

test('state matrix permits only approved transitions', () => {
  assert.equal(canTransitionJob('queued', 'preparing'), true);
  assert.equal(canTransitionJob('queued', 'submitting'), false);
  assert.equal(canTransitionJob('preparing', 'submitting'), true);
  assert.equal(canTransitionJob('preparing', 'running'), true);
  assert.equal(canTransitionJob('submitting', 'running'), true);
  assert.equal(canTransitionJob('submitting', 'queued'), false);
  assert.equal(canTransitionJob('running', 'downloading'), true);
  assert.equal(canTransitionJob('downloading', 'reconnecting'), true);
  assert.equal(canTransitionJob('downloading', 'succeeded'), true);
  assert.equal(canTransitionJob('succeeded', 'queued'), false);
  assert.throws(() => assertJobTransition('queued', 'succeeded'), /Illegal job transition/);
});

test('restart recovery never blindly resubmits a remote job', () => {
  assert.equal(getRestartRecoveryStatus({ status: 'submitting', promptId: null }), 'submission_uncertain');
  assert.equal(getRestartRecoveryStatus({ status: 'preparing', promptId: null }), 'queued');
  assert.equal(getRestartRecoveryStatus({ status: 'submitting', promptId: 'remote-1' }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'running', promptId: 'remote-1' }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'downloading', promptId: 'remote-1', payload: { nodeKind: 'gpt-video' } }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'downloading', promptId: null, payload: { nodeKind: 'gpt-image' } }), 'failed');
  assert.equal(getRestartRecoveryStatus({ status: 'queued' }), 'queued');
});

test('a crash after submission intent becomes terminal and cannot be retried', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-submission-uncertain-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  try {
    const repository = new JobRepository(database);
    createQueuedJob(repository);
    repository.transition('job-1', 'preparing');
    repository.transition('job-1', 'submitting');

    const recovered = repository.recoverAfterRestart()[0];
    assert.equal(recovered.status, 'submission_uncertain');
    assert.equal(recovered.error.code, 'SUBMISSION_UNCERTAIN');
    assert.equal(recovered.error.safeToRetry, false);
    assert.throws(() => repository.retry('job-1'), /requires manual reconciliation/);
    assert.equal(repository.getJob('job-1').status, 'submission_uncertain');
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const uncertainIsNewer of [false, true]) {
  test(`restart blocks a sibling preparing job when uncertain submit is ${uncertainIsNewer ? 'newer' : 'older'}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-recovery-order-'));
    const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
    try {
      const repository = new JobRepository(database);
      repository.createGroup({
        id: 'pending-group', projectId: 'shared-project', nodeId: 'shared-node', providerType: 'comfy', profileId: 'cloud-1', seedMode: 'fixed', baseSeed: 1
      }, [{ id: 'pending-job', payload: { nodeKind: 'h3-video' }, seed: 1 }]);
      repository.createGroup({
        id: 'uncertain-group', projectId: 'shared-project', nodeId: 'shared-node', providerType: 'comfy', profileId: 'cloud-1', seedMode: 'fixed', baseSeed: 2
      }, [{ id: 'uncertain-job', payload: { nodeKind: 'h3-video' }, seed: 2 }]);
      repository.transition('pending-job', 'preparing');
      repository.transition('uncertain-job', 'preparing');
      repository.transition('uncertain-job', 'submitting');
      const older = new Date(0).toISOString();
      const newer = new Date(1000).toISOString();
      database.connection.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run(uncertainIsNewer ? older : newer, 'pending-job');
      database.connection.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run(uncertainIsNewer ? newer : older, 'uncertain-job');

      const recovered = repository.recoverAfterRestart();
      assert.equal(repository.getJob('uncertain-job').status, 'submission_uncertain');
      const blocked = repository.getJob('pending-job');
      assert.equal(blocked.status, 'failed');
      assert.equal(blocked.error.code, 'JOB_SUBMISSION_UNCERTAIN');
      assert.equal(recovered.some((job) => job.id === 'pending-job' && job.status === 'queued'), false);
    } finally {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('job state survives database close and reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-repository-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  try {
    let database = new VelaDatabase(databasePath);
    let repository = new JobRepository(database);
    createQueuedJob(repository);
    repository.transition('job-1', 'preparing');
    repository.transition('job-1', 'submitting');
    repository.transition('job-1', 'running', { promptId: 'prompt-remote' });
    database.close();

    database = new VelaDatabase(databasePath);
    repository = new JobRepository(database);
    assert.equal(repository.getJob('job-1').status, 'running');
    assert.equal(repository.recoverAfterRestart()[0].status, 'reconnecting');
    assert.equal(repository.getJob('job-1').promptId, 'prompt-remote');
    database.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('progress updates do not change the durable job state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-progress-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  try {
    const repository = new JobRepository(database);
    createQueuedJob(repository);
    repository.transition('job-1', 'preparing');
    repository.transition('job-1', 'submitting');
    repository.transition('job-1', 'running', { promptId: 'video-task-1', progress: 0.1 });
    const updated = repository.updateProgress('job-1', 0.55);
    assert.equal(updated.status, 'running');
    assert.equal(updated.promptId, 'video-task-1');
    assert.equal(updated.progress, 0.55);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('retrying a completed failed Comfy prompt clears its remote id and resubmits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-comfy-retry-'));
  const database = new VelaDatabase(path.join(directory, 'vela.sqlite'));
  try {
    const repository = new JobRepository(database);
    repository.createGroup({
      id: 'group-1', projectId: 'project-1', nodeId: 'node-1', providerType: 'comfy', profileId: 'cloud-1', seedMode: 'fixed', baseSeed: 7
    }, [{ id: 'job-1', payload: { nodeKind: 'wan-video-process' }, seed: 7 }]);
    repository.transition('job-1', 'preparing');
    repository.transition('job-1', 'submitting');
    repository.transition('job-1', 'running', { promptId: 'completed-without-output', progress: 0.1 });
    repository.transition('job-1', 'failed', { error: { code: 'OUTPUT_NOT_FOUND' } });

    const retried = repository.retry('job-1');
    assert.equal(retried.status, 'queued');
    assert.equal(retried.promptId, null);
    assert.equal(retried.progress, 0);
    assert.equal(retried.retryCount, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
