export const VELA_SCHEMA_VERSION: 1;
export const VELA_EXPORT_VERSION: 1;
export const MAX_BATCH_SIZE: 50;
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
