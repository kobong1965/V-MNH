import { JOB_STATUSES } from '../../shared/vela-contracts.js';

export const LEGAL_JOB_TRANSITIONS = Object.freeze({
  queued: ['submitting', 'cancelled'],
  submitting: ['running', 'queued', 'failed'],
  running: ['downloading', 'reconnecting', 'failed', 'cancelled'],
  reconnecting: ['running', 'downloading', 'failed', 'cancelled'],
  downloading: ['succeeded', 'reconnecting', 'failed'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued']
});

export const canTransitionJob = (from, to) => {
  if (!JOB_STATUSES.includes(from) || !JOB_STATUSES.includes(to)) return false;
  return LEGAL_JOB_TRANSITIONS[from].includes(to);
};

export const assertJobTransition = (from, to) => {
  if (!canTransitionJob(from, to)) throw new Error(`Illegal job transition: ${from} -> ${to}`);
};

export const getRestartRecoveryStatus = (job) => {
  if (job.status === 'submitting') return job.promptId ? 'reconnecting' : 'queued';
  if (job.status === 'running') return 'reconnecting';
  if (job.status === 'downloading') {
    return job.promptId && job.payload?.nodeKind === 'gpt-video' ? 'reconnecting' : 'failed';
  }
  return job.status;
};
