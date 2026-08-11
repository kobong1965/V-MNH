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
  assert.equal(canTransitionJob('queued', 'submitting'), true);
  assert.equal(canTransitionJob('submitting', 'running'), true);
  assert.equal(canTransitionJob('running', 'downloading'), true);
  assert.equal(canTransitionJob('downloading', 'reconnecting'), true);
  assert.equal(canTransitionJob('downloading', 'succeeded'), true);
  assert.equal(canTransitionJob('succeeded', 'queued'), false);
  assert.throws(() => assertJobTransition('queued', 'succeeded'), /Illegal job transition/);
});

test('restart recovery never blindly resubmits a remote job', () => {
  assert.equal(getRestartRecoveryStatus({ status: 'submitting', promptId: null }), 'queued');
  assert.equal(getRestartRecoveryStatus({ status: 'submitting', promptId: 'remote-1' }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'running', promptId: 'remote-1' }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'downloading', promptId: 'remote-1', payload: { nodeKind: 'gpt-video' } }), 'reconnecting');
  assert.equal(getRestartRecoveryStatus({ status: 'downloading', promptId: null, payload: { nodeKind: 'gpt-image' } }), 'failed');
  assert.equal(getRestartRecoveryStatus({ status: 'queued' }), 'queued');
});

test('job state survives database close and reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-job-repository-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  try {
    let database = new VelaDatabase(databasePath);
    let repository = new JobRepository(database);
    createQueuedJob(repository);
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
