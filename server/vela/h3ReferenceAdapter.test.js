import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  createH3OutpaintInput,
  finalizeH3Outpaint,
  inspectReferenceAspect
} from './h3ReferenceAdapter.js';

test('H3 outpaint input preserves the complete source inside a 9:16 safe area', async () => {
  const source = await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 210, g: 80, b: 40 } }
  }).png().toBuffer();

  const inspection = await inspectReferenceAspect(source, '9:16');
  assert.equal(inspection.matches, false);

  const prepared = await createH3OutpaintInput(source, '9:16');
  assert.equal(prepared.size, '1024x1536');
  assert.deepEqual(prepared.targetRect, { left: 80, top: 0, width: 864, height: 1536 });
  assert.equal(prepared.sourceRect.width, 864);
  assert.equal(prepared.sourceRect.height, 864);
  assert.ok(prepared.sourceRect.left >= prepared.targetRect.left);
  assert.ok(prepared.sourceRect.top >= prepared.targetRect.top);

  const mask = await sharp(prepared.mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => mask.data[((y * mask.info.width + x) * 4) + 3];
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(
    prepared.sourceRect.left + Math.floor(prepared.sourceRect.width / 2),
    prepared.sourceRect.top + Math.floor(prepared.sourceRect.height / 2)
  ), 255);

  const finalized = await finalizeH3Outpaint(prepared.image, '9:16', { width: 640, height: 1152 });
  const finalMetadata = await sharp(finalized).metadata();
  assert.deepEqual([finalMetadata.width, finalMetadata.height], [640, 1152]);
});

test('matching H3 reference ratios skip expansion detection', async () => {
  const source = await sharp({
    create: { width: 900, height: 1600, channels: 3, background: { r: 20, g: 40, b: 60 } }
  }).png().toBuffer();
  assert.equal((await inspectReferenceAspect(source, '9:16')).matches, true);
});
