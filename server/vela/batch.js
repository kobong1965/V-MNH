import crypto from 'node:crypto';

import { MAX_BATCH_SIZE, validateJobDraft, validateJobGroupDraft } from '../../shared/vela-contracts.js';

const normalizeSeed = (value) => Math.abs(Math.trunc(Number(value) || 0)) % 2147483647;

const POSE_VARIATION_DIRECTIONS = [
  'Natural relaxed FRONT view: face the camera with an easy weight shift, one hand optionally resting in an existing trouser pocket and the other arm loose.',
  'Natural relaxed LEFT view: turn the body toward the left in a believable three-quarter or side profile, shoulders loose and feet placed casually.',
  'Natural relaxed RIGHT view: turn the body toward the right in a different three-quarter or side profile, with an ordinary hand movement and balanced posture.',
  'Natural relaxed BACK view: show the back or a back three-quarter angle, with a subtle glance or small turn and arms resting naturally.',
  'Natural relaxed movement between directions: take a small walking or turning step with believable balance, loose arms and realistic cloth tension.'
];

export const composeIndependentImageBatchPrompt = (payload, index, count) => {
  const prompt = String(payload.prompt || '').trim();
  if (payload.nodeKind !== 'gpt-image' || count <= 1) return prompt;

  const instructions = [
    `BATCH OUTPUT ${index + 1} OF ${count}: Return exactly ONE standalone, full-frame photograph in this request.`,
    'Never create a collage, grid, contact sheet, diptych, triptych, split-screen, storyboard, poster, comparison layout, or multiple panels inside the image.'
  ];
  if (payload.imageBatchMode === 'pose-variation') {
    instructions.push(
      `POSE DIRECTION FOR THIS ONE OUTPUT: ${POSE_VARIATION_DIRECTIONS[index % POSE_VARIATION_DIRECTIONS.length]}`,
      'Across the batch, clearly cover front, back, left and right body directions plus one relaxed movement. Make every action visibly different while keeping the person natural, loose, spontaneous, anatomically correct and appropriate to the existing crop and location. Avoid stiff posing, repeated hand positions and repeated body angles. Do not add a prop that is not already present.'
    );
  }
  return [prompt, ...instructions].filter(Boolean).join('\n\n');
};

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
    payload: {
      ...draft.payload,
      prompt: composeIndependentImageBatchPrompt(draft.payload, index, draft.count),
      seed,
      batchIndex: index,
      batchCount: draft.count
    }
  }));
  return { group, jobs };
};
