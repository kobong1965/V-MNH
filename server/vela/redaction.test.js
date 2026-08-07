import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSecrets, safeLogJson } from './redaction.js';

test('redactor removes secrets from keys, bearer values and signed URLs', () => {
  const redacted = redactSecrets({
    apiKey: 'sk-plain',
    nested: { Authorization: 'Bearer abc.123', url: 'https://host/file?signature=private&x=1' },
    safe: 'profile-name'
  });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /sk-plain|abc\.123|private/);
  assert.match(serialized, /profile-name/);
  assert.doesNotMatch(safeLogJson(redacted), /Bearer abc/);
});
