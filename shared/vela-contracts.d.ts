export const VELA_SCHEMA_VERSION: 1;
export const VELA_EXPORT_VERSION: 1;
export const MAX_BATCH_SIZE: 50;
export const AUTO_COMFY_PROFILE_ID: 'auto-comfy';
export const VELA_CONTROL_PROTOCOL_VERSION: 2;
export const VELA_VIDEO_PROVIDER_CONTRACT_VERSION: 1;
export const VELA_CONTROL_CAPABILITIES: Readonly<{
  batchImageWorkflows: Readonly<{
    contractVersion: 2;
    listMethod: 'GET';
    listPath: '/api/vela/batches';
    manifestMethod: 'GET';
    manifestPath: '/api/vela/batches/{batchId}/sync-manifest';
    manifestTargetQuery: 'targetId';
    inboxMethod: 'GET';
    inboxPath: '/api/vela/sync-inbox';
    inboxPagination: 'cursor';
    inboxPageSize: 500;
    acknowledgeMethod: 'POST';
    acknowledgePath: '/api/vela/sync-inbox/{batchId}/ack';
    supportedClientScopes: readonly ['materials:read'];
    syncTarget: 'storyworks';
    multipleSyncTargets: true;
    independentProjectPerImage: false;
    singleProjectWithIndependentWorkflowGroups: true;
    maxOutputsPerItem: 20;
    maxOutputsPerManifest: 1000;
  }>;
  durableVideoProvider: Readonly<{
    contractVersion: 1;
    createOrReturnByExternalKey: true;
    createOrReturnMethod: 'PUT';
    createOrReturnPath: '/api/vela/jobs/by-external-key/{externalKey}';
    lookupMethod: 'GET';
    lookupPath: '/api/vela/jobs/by-external-key/{externalKey}';
    externalKeyField: 'path.externalKey';
    contractFingerprintField: 'body.contractFingerprint';
    contractFingerprint: 'sha256-lowercase-hex';
    canonicalization: 'vela-external-h3-draft-v1';
    maxJobsPerExternalKey: 1;
    terminalSubmissionUncertain: true;
  }>;
}>;
export const JOB_STATUSES: readonly string[];
export const SEED_MODES: readonly string[];
export const PROFILE_TYPES: readonly string[];
export class ContractValidationError extends Error { path: string; }
export function assertNoPlaintextSecrets(value: unknown, path?: string): void;
export function validateProjectDocument<T>(project: T): T;
export function validateMediaRecord<T>(media: T): T;
export function validatePublicProfile<T>(profile: T): T;
export function validateJobDraft<T>(job: T): T;
export function validateJobGroupDraft<T>(group: T): T;
export function validateExternalJobContract(input: { externalKey: string; contractFingerprint: string }): {
  externalKey: string;
  contractFingerprint: string;
};
export function validateExternalJobKey(externalKey: string): string;
