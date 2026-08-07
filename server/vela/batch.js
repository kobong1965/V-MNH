import crypto from 'node:crypto';

import { MAX_BATCH_SIZE, validateJobDraft, validateJobGroupDraft } from '../../shared/vela-contracts.js';

const normalizeSeed = (value) => Math.abs(Math.trunc(Number(value) || 0)) % 2147483647;

const createDeterministicRandom = (seed) => {
  let state = (normalizeSeed(seed) || 0x6d2b79f5) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const createSeeds = ({ count, mode, baseSeed }) => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_SIZE) {
    throw new Error(`Batch count must be between 1 and ${MAX_BATCH_SIZE}`);
  }
  const normalizedBase = normalizeSeed(baseSeed);
  if (mode === 'fixed') return Array.from({ length: count }, () => normalizedBase);
  if (mode === 'increment') return Array.from({ length: count }, (_, index) => (normalizedBase + index) % 2147483647);
  if (mode === 'random') {
    const random = createDeterministicRandom(normalizedBase);
    return Array.from({ length: count }, () => Math.floor(random() * 2147483647));
  }
  throw new Error(`Unsupported seed mode: ${mode}`);
};

export const expandJobGroup = (draft) => {
  validateJobDraft(draft);
  validateJobGroupDraft({
    projectId: draft.projectId,
    nodeId: draft.nodeId,
    count: draft.count,
    seedMode: draft.seedMode
  });
  const groupId = draft.groupId || crypto.randomUUID();
  const baseSeed = normalizeSeed(draft.seed);
  const seeds = createSeeds({ count: draft.count, mode: draft.seedMode, baseSeed });
  const group = {
    id: groupId,
    projectId: draft.projectId,
    nodeId: draft.nodeId,
    providerType: draft.providerType,
    profileId: draft.profileId,
    seedMode: draft.seedMode,
    baseSeed
  };
  const jobs = seeds.map((seed, index) => ({
    id: crypto.randomUUID(),
    index,
    seed,
    workflowVersion: draft.workflowVersion,
    priority: draft.priority || 0,
    payload: { ...draft.payload, seed, batchIndex: index, batchCount: draft.count }
  }));
  return { group, jobs };
};
