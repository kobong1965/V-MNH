import assert from 'node:assert/strict';
import test from 'node:test';

import { getBatchImageValidationError, MAX_BATCH_IMAGE_BYTES } from './batchImageValidation.ts';

test('source and benchmark images share the same inclusive 100MB boundary', () => {
  const atLimit = { type: 'image/png', size: MAX_BATCH_IMAGE_BYTES };
  const overLimit = { type: 'image/png', size: MAX_BATCH_IMAGE_BYTES + 1 };

  assert.equal(getBatchImageValidationError(atLimit, 'source'), null);
  assert.equal(getBatchImageValidationError(atLimit, 'benchmark'), null);
  assert.match(getBatchImageValidationError(overLimit, 'source') || '', /100MB/);
  assert.match(getBatchImageValidationError(overLimit, 'benchmark') || '', /100MB/);
});

test('source and benchmark validation reject non-image content', () => {
  const textFile = { type: 'text/plain', size: 128 };
  assert.match(getBatchImageValidationError(textFile, 'source') || '', /非图片/);
  assert.match(getBatchImageValidationError(textFile, 'benchmark') || '', /对标图必须/);
});
