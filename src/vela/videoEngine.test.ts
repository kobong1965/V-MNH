import assert from 'node:assert/strict';
import test from 'node:test';

import type { NodeData } from '../types.ts';
import { createVideoEngineUpdate, isMiniMaxH3Profile, normalizeH3VideoDuration } from './videoEngine.ts';

const videoNode = (): NodeData => ({
  id: 'video-1',
  type: 'Video' as NodeData['type'],
  kind: 'gpt-video',
  x: 0,
  y: 0,
  prompt: '镜头',
  status: 'success' as NodeData['status'],
  model: 'video-generator',
  aspectRatio: '9:16',
  resolution: '2K',
  parentIds: ['image-1'],
  videoDuration: 7,
  profileId: 'gpt-profile',
  jobGroupId: 'job-group'
});

test('H3 duration snaps Storyworks shots to supported buckets', () => {
  assert.equal(normalizeH3VideoDuration(4), 5);
  assert.equal(normalizeH3VideoDuration(7), 10);
  assert.equal(normalizeH3VideoDuration(15), 15);
});

test('switching a video node to H3 clears the incompatible account without removing its content', () => {
  const current = videoNode();
  const update = createVideoEngineUpdate('h3-video', current);

  assert.deepEqual(update, {
    kind: 'h3-video',
    model: 'video-generator',
    profileId: undefined,
    status: 'idle',
    generationProgress: undefined,
    errorMessage: undefined,
    jobGroupId: undefined,
    videoModel: 'minimax-h3',
    videoDuration: 10,
    videoGenerationMode: 'reference-to-video',
    resolution: '2K',
    h3Acceleration: 'turbo-4',
    h3Upscale: 'off',
    h3FrameFit: undefined,
    h3OutpaintProfileId: undefined,
    h3ReferenceImageSize: 'match'
  });
  assert.equal(current.prompt, '镜头');
  assert.deepEqual(current.parentIds, ['image-1']);
});

test('H3 profile filtering excludes unrelated ComfyUI workflows', () => {
  const base = {
    id: 'profile', type: 'comfy' as const, name: 'AutoDL MiniMax H3 Pro', baseUrl: 'http://127.0.0.1:8188', timeoutMs: 60_000,
    maxConcurrency: 1, secretConfigured: true, createdAt: '', updatedAt: '', platform: 'autodl' as const, websocketUrl: '',
    transport: 'direct' as const, sshHost: '', sshPort: 22, sshUsername: '', sshPrivateKeyPath: '', sshLocalPort: 18188,
    sshRemoteHost: '', sshRemotePort: 8188, sshStartScript: '', autoPowerEnabled: true, autoPowerProvider: 'autodl-pro' as const,
    autodlInstanceUuid: '', idleShutdownMinutes: 5, powerOnTimeoutMs: 600_000, autoPowerCredentialConfigured: true,
    autoPowerCredentialStatus: 'ready' as const, authType: 'none' as const, customHeaderNames: [], workflowVersion: 'minimax-h3-pro-v1',
    tags: ['MiniMax H3'], notes: '', retentionNote: ''
  };

  assert.equal(isMiniMaxH3Profile(base), true);
  assert.equal(isMiniMaxH3Profile({ ...base, name: 'Wan 2.2', workflowVersion: 'wan22-v1', tags: ['Wan'] }), false);
});
