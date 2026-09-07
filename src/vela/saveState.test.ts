import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldAttemptAutoSave, shouldClearDirtyAfterSave } from './saveState.ts';

test('a completed save clears dirty only when no newer edit exists', () => {
  assert.equal(shouldClearDirtyAfterSave(7, 7), true);
  assert.equal(shouldClearDirtyAfterSave(7, 8), false);
});

test('an empty but modified canvas still participates in auto-save', () => {
  assert.equal(shouldAttemptAutoSave(false), false);
  assert.equal(shouldAttemptAutoSave(true), true);
});
