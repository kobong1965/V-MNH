import assert from 'node:assert/strict';
import test from 'node:test';

import { decodedBase64ByteLength, decodedBase64ByteLengthFromShape } from './base64Size.js';

test('calculates padded base64 payload sizes exactly', () => {
  assert.equal(decodedBase64ByteLength('YQ=='), 1);
  assert.equal(decodedBase64ByteLength('YWI='), 2);
  assert.equal(decodedBase64ByteLength('YWJj'), 3);
});

test('keeps the exact 100MB boundary valid and rejects the next byte', () => {
  const maxBytes = 100 * 1024 * 1024;
  const maxPayloadLength = 4 * Math.ceil(maxBytes / 3);
  const maxPaddingLength = (3 - (maxBytes % 3)) % 3;
  const oversizedBytes = maxBytes + 1;
  const oversizedPayloadLength = 4 * Math.ceil(oversizedBytes / 3);
  const oversizedPaddingLength = (3 - (oversizedBytes % 3)) % 3;

  assert.equal(decodedBase64ByteLengthFromShape(maxPayloadLength, maxPaddingLength), maxBytes);
  assert.equal(decodedBase64ByteLengthFromShape(oversizedPayloadLength, oversizedPaddingLength), oversizedBytes);
});
