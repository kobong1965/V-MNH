export const shouldClearDirtyAfterSave = (savedRevision: number, currentRevision: number) => (
  savedRevision === currentRevision
);

export const shouldAttemptAutoSave = (isDirty: boolean) => isDirty;
