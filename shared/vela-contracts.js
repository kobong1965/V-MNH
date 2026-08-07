export const VELA_SCHEMA_VERSION = 1;
export const VELA_EXPORT_VERSION = 1;
export const MAX_BATCH_SIZE = 50;

export const JOB_STATUSES = Object.freeze([
  'queued',
  'submitting',
  'running',
  'reconnecting',
  'downloading',
  'succeeded',
  'failed',
  'cancelled'
]);

export const SEED_MODES = Object.freeze(['fixed', 'increment', 'random']);
export const PROFILE_TYPES = Object.freeze(['gpt', 'comfy']);

const FORBIDDEN_SECRET_KEY = /(^|_)(api_?key|token|secret|authorization|password)($|_)/i;

export class ContractValidationError extends Error {
  constructor(message, path = '$') {
    super(`${path}: ${message}`);
    this.name = 'ContractValidationError';
    this.path = path;
  }
}

const assertObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractValidationError('必须是对象', path);
  }
};

const assertString = (value, path, { min = 1, max = 256 } = {}) => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new ContractValidationError(`必须是 ${min}-${max} 个字符的字符串`, path);
  }
};

const assertFiniteNumber = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractValidationError('必须是有限数字', path);
  }
};

export const assertNoPlaintextSecrets = (value, path = '$') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY.test(key) && child !== undefined && child !== null && child !== false) {
      throw new ContractValidationError('禁止保存明文凭据', `${path}.${key}`);
    }
    assertNoPlaintextSecrets(child, `${path}.${key}`);
  }
};

export const validateProjectDocument = (project) => {
  assertObject(project, '$');
  if (project.schemaVersion !== VELA_SCHEMA_VERSION) {
    throw new ContractValidationError(`不支持的 schemaVersion ${project.schemaVersion}`, '$.schemaVersion');
  }
  assertString(project.id, '$.id', { max: 128 });
  assertString(project.name, '$.name', { max: 120 });
  assertString(project.createdAt, '$.createdAt', { max: 64 });
  assertString(project.updatedAt, '$.updatedAt', { max: 64 });
  if (!Array.isArray(project.nodes)) throw new ContractValidationError('必须是数组', '$.nodes');
  if (!Array.isArray(project.groups)) throw new ContractValidationError('必须是数组', '$.groups');
  assertObject(project.viewport, '$.viewport');
  assertFiniteNumber(project.viewport.x, '$.viewport.x');
  assertFiniteNumber(project.viewport.y, '$.viewport.y');
  assertFiniteNumber(project.viewport.zoom, '$.viewport.zoom');
  project.nodes.forEach((node, index) => {
    assertObject(node, `$.nodes[${index}]`);
    assertString(node.id, `$.nodes[${index}].id`, { max: 128 });
    assertString(node.type, `$.nodes[${index}].type`, { max: 64 });
    assertFiniteNumber(node.x, `$.nodes[${index}].x`);
    assertFiniteNumber(node.y, `$.nodes[${index}].y`);
  });
  assertNoPlaintextSecrets(project);
  return project;
};

export const validateMediaRecord = (media) => {
  assertObject(media, '$');
  assertString(media.id, '$.id', { max: 128 });
  assertString(media.projectId, '$.projectId', { max: 128 });
  if (!['image', 'video', 'audio'].includes(media.kind)) {
    throw new ContractValidationError('kind 必须是 image、video 或 audio', '$.kind');
  }
  assertString(media.relativePath, '$.relativePath', { max: 1024 });
  assertString(media.sha256, '$.sha256', { min: 64, max: 64 });
  return media;
};

export const validatePublicProfile = (profile) => {
  assertObject(profile, '$');
  assertString(profile.id, '$.id', { max: 128 });
  assertString(profile.name, '$.name', { max: 120 });
  if (!PROFILE_TYPES.includes(profile.type)) {
    throw new ContractValidationError('type 必须是 gpt 或 comfy', '$.type');
  }
  if (typeof profile.secretConfigured !== 'boolean') {
    throw new ContractValidationError('必须是布尔值', '$.secretConfigured');
  }
  assertNoPlaintextSecrets(profile);
  return profile;
};

export const validateJobDraft = (job) => {
  assertObject(job, '$');
  assertString(job.projectId, '$.projectId', { max: 128 });
  assertString(job.nodeId, '$.nodeId', { max: 128 });
  assertString(job.profileId, '$.profileId', { max: 128 });
  assertString(job.providerType, '$.providerType', { max: 64 });
  assertObject(job.payload, '$.payload');
  assertNoPlaintextSecrets(job.payload, '$.payload');
  return job;
};

export const validateJobGroupDraft = (group) => {
  assertObject(group, '$');
  assertString(group.projectId, '$.projectId', { max: 128 });
  assertString(group.nodeId, '$.nodeId', { max: 128 });
  if (!Number.isInteger(group.count) || group.count < 1 || group.count > MAX_BATCH_SIZE) {
    throw new ContractValidationError(`count 必须是 1-${MAX_BATCH_SIZE} 的整数`, '$.count');
  }
  if (!SEED_MODES.includes(group.seedMode)) {
    throw new ContractValidationError('seedMode 必须是 fixed、increment 或 random', '$.seedMode');
  }
  return group;
};
