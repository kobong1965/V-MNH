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

test('MiniMax H3 prompt supports image input, Turbo LoRA and AI HD output', () => {
  const graph = buildMiniMaxH3Prompt({
    prompt: '人物向镜头走来',
    seed: 42,
    duration: 5,
    aspectRatio: '9:16',
    resolution: '1080p',
    acceleration: 'turbo-8',
    firstFrame: 'vela/input.png'
  });
  assert.equal(graph['2'].class_type, 'LoraLoaderModelOnly');
  assert.equal(graph['6'].inputs.first_frame[0], '22');
  assert.equal(graph['22'].class_type, 'ImageScale');
  assert.equal(graph['22'].inputs.crop, 'center');
  assert.deepEqual([graph['22'].inputs.width, graph['22'].inputs.height], [640, 1152]);
  assert.deepEqual([graph['6'].inputs.width, graph['6'].inputs.height], [640, 1152]);
  assert.equal(graph['14'].class_type, 'UpscaleModelLoader');
  assert.equal(graph['14'].inputs.model_name, 'RealESRGAN_x2plus.pth');
  assert.deepEqual(
    [graph['18'].inputs.width, graph['18'].inputs.height],
    [1080, 1920]
  );
  assert.equal(graph['16'].inputs.codec, 'auto');
});

test('MiniMax H3 standard 720p prompt skips LoRA and upscaling', () => {
  const graph = buildMiniMaxH3Prompt({ acceleration: 'standard', resolution: '720p' });
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
