import crypto from 'node:crypto';

import {
  AUTO_COMFY_PROFILE_ID,
  ContractValidationError,
  validateJobDraft,
  validateJobGroupDraft
} from '../../shared/vela-contracts.js';

export const EXTERNAL_H3_CONTRACT_VERSION = 1;
export const EXTERNAL_H3_CANONICALIZATION = 'vela-external-h3-draft-v1';

export class ContractFingerprintMismatchError extends Error {
  constructor(expectedFingerprint) {
    super('contractFingerprint does not match the canonical external H3 job draft');
    this.name = 'ContractFingerprintMismatchError';
    this.status = 422;
    this.code = 'CONTRACT_FINGERPRINT_MISMATCH';
    this.expectedFingerprint = expectedFingerprint;
  }
}

const normalizeSeed = (value) => Math.abs(Math.trunc(Number(value) || 0)) % 2147483647;

const canonicalizeJson = (value, path = '$.payload') => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ContractValidationError('必须是有限数字', path);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') {
    throw new ContractValidationError('必须是可 JSON 序列化的值', path);
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key], `${path}.${key}`)])
  );
};

export const normalizeExternalH3Draft = (draft) => {
  validateJobDraft(draft);
  if (draft.providerType !== 'comfy') {
    throw new ContractValidationError('外部原子视频任务仅支持 comfy provider', '$.providerType');
  }
  if (draft.profileId !== AUTO_COMFY_PROFILE_ID) {
    throw new ContractValidationError('外部原子视频任务必须使用 auto-comfy', '$.profileId');
  }
  if (draft.payload.nodeKind !== 'h3-video') {
    throw new ContractValidationError('外部原子视频任务仅支持 h3-video', '$.payload.nodeKind');
  }
  if (draft.payload.videoGenerationMode !== 'reference-to-video') {
    throw new ContractValidationError('外部 H3 视频任务仅支持 reference-to-video', '$.payload.videoGenerationMode');
  }
  if (draft.count !== 1) {
    throw new ContractValidationError('外部幂等任务每个 externalKey 只允许 1 个 job', '$.count');
  }
  validateJobGroupDraft({
    projectId: draft.projectId,
    nodeId: draft.nodeId,
    count: draft.count,
    seedMode: draft.seedMode
  });

  return canonicalizeJson({
    contractVersion: EXTERNAL_H3_CONTRACT_VERSION,
    projectId: draft.projectId,
    nodeId: draft.nodeId,
    profileId: AUTO_COMFY_PROFILE_ID,
    providerType: 'comfy',
    payload: canonicalizeJson(draft.payload),
    count: 1,
    seedMode: draft.seedMode,
    seed: normalizeSeed(draft.seed),
    workflowVersion: draft.workflowVersion || null,
    priority: Number.isFinite(Number(draft.priority)) ? Math.trunc(Number(draft.priority)) : 0
  }, '$');
};

export const canonicalExternalH3DraftJson = (draft) => JSON.stringify(normalizeExternalH3Draft(draft));

export const computeExternalH3ContractFingerprint = (draft) => crypto
  .createHash('sha256')
  .update(canonicalExternalH3DraftJson(draft), 'utf8')
  .digest('hex');

export const assertExternalH3ContractFingerprint = (draft, suppliedFingerprint) => {
  const expectedFingerprint = computeExternalH3ContractFingerprint(draft);
  if (suppliedFingerprint !== expectedFingerprint) {
    throw new ContractFingerprintMismatchError(expectedFingerprint);
  }
  return normalizeExternalH3Draft(draft);
};
