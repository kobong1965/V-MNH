import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTO_COMFY_PROFILE_ID } from '../../shared/vela-contracts.js';
import {
  assertExternalH3ContractFingerprint,
  computeExternalH3ContractFingerprint
} from './externalJobContract.js';

const draft = () => ({
  projectId: 'project-1', nodeId: 'shot-1-take-1', profileId: AUTO_COMFY_PROFILE_ID, providerType: 'comfy',
  payload: {
    nodeKind: 'h3-video', videoGenerationMode: 'reference-to-video', prompt: '<Picture 1> moves',
    referenceUrls: ['/media/person-v3.png', '/media/scene-v2.png'], requiredReferenceCount: 2,
    duration: 5, aspectRatio: '16:9', resolution: '720p'
  },
  count: 1, seedMode: 'fixed', seed: 17
});

test('external H3 fingerprint is canonical and binds prompt, seed, references and their order', () => {
  const original = draft();
  const reordered = { ...original, payload: Object.fromEntries(Object.entries(original.payload).reverse()) };
  const fingerprint = computeExternalH3ContractFingerprint(original);
  assert.equal(computeExternalH3ContractFingerprint(reordered), fingerprint);
  for (const changed of [
    { ...original, seed: 18 },
    { ...original, payload: { ...original.payload, prompt: 'different prompt' } },
    { ...original, payload: { ...original.payload, referenceUrls: [...original.payload.referenceUrls].reverse() } }
  ]) assert.notEqual(computeExternalH3ContractFingerprint(changed), fingerprint);
  assert.equal(assertExternalH3ContractFingerprint(original, fingerprint).count, 1);
  assert.throws(() => assertExternalH3ContractFingerprint(original, 'a'.repeat(64)), (error) => error.code === 'CONTRACT_FINGERPRINT_MISMATCH' && error.status === 422);
});

test('external atomic contract rejects non-H3, non-R2V, non-auto and multi-job drafts', () => {
  const original = draft();
  for (const changed of [
    { ...original, providerType: 'fake' },
    { ...original, profileId: 'specific-profile' },
    { ...original, payload: { ...original.payload, nodeKind: 'gpt-video' } },
    { ...original, payload: { ...original.payload, videoGenerationMode: 'first-frame' } },
    { ...original, count: 2 }
  ]) assert.throws(() => computeExternalH3ContractFingerprint(changed));
});
