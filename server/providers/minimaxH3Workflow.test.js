import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMiniMaxH3Prompt,
  minimaxH3FrameCount,
  resolveMiniMaxH3Dimensions
} from './minimaxH3Workflow.js';

test('MiniMax H3 frame count follows the model 17k+5 grid', () => {
  assert.equal(minimaxH3FrameCount(5), 124);
  assert.equal((minimaxH3FrameCount(10) - 5) % 17, 0);
});

test('MiniMax H3 R2V prompt connects every reference image, Ref2VA Turbo LoRA and bounded HD output', () => {
  const graph = buildMiniMaxH3Prompt({
    prompt: '人物向镜头走来',
    seed: 42,
    duration: 5,
    aspectRatio: '9:16',
    resolution: '1080p',
    acceleration: 'turbo-4',
    referenceImages: ['vela/person.png', 'vela/scene.png', 'vela/prop.png']
  });
  assert.equal(graph['2'].class_type, 'LoraLoaderModelOnly');
  assert.equal(graph['1'].inputs.unet_name, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors');
  assert.equal(graph['6'].class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(graph['6'].inputs['ref_images.ref_image_0'], ['20', 0]);
  assert.deepEqual(graph['6'].inputs['ref_images.ref_image_1'], ['21', 0]);
  assert.deepEqual(graph['6'].inputs['ref_images.ref_image_2'], ['22', 0]);
  assert.equal(graph['20'].inputs.image, 'vela/person.png');
  assert.deepEqual([graph['6'].inputs.width, graph['6'].inputs.height], [640, 1152]);
  assert.equal(graph['14'], undefined);
  assert.equal(graph['17'], undefined);
  assert.deepEqual(graph['18'].inputs.image, ['12', 0]);
  assert.deepEqual(
    [graph['18'].inputs.width, graph['18'].inputs.height],
    [1080, 1920]
  );
  assert.equal(graph['16'].inputs.codec, 'auto');
});

test('MiniMax H3 standard 720p R2V prompt skips LoRA and upscaling', () => {
  const graph = buildMiniMaxH3Prompt({ acceleration: 'standard', resolution: '720p', referenceImages: ['vela/reference.png'] });
  assert.equal(graph['2'], undefined);
  assert.equal(graph['10'].inputs.steps, 20);
  assert.equal(graph['14'], undefined);
  assert.deepEqual(resolveMiniMaxH3Dimensions({ resolution: '720p', aspectRatio: '16:9' }), {
    width: 1152,
    height: 640,
    targetWidth: undefined,
    targetHeight: undefined
  });
});

test('MiniMax H3 R2V requires one to nine references', () => {
  assert.throws(() => buildMiniMaxH3Prompt({ referenceImages: [] }), /至少需要 1 张/);
  assert.throws(() => buildMiniMaxH3Prompt({ referenceImages: Array.from({ length: 10 }, (_, index) => `r-${index}.png`) }), /最多支持 9 张/);
});
