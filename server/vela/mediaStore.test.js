import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ProjectMediaStore } from './mediaStore.js';
import { ProjectStore } from './projectStore.js';

test('provider result download retries transient GET failures before saving the image', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-media-download-'));
  let calls = 0;
  const projectStore = new ProjectStore({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects') });
  const mediaStore = new ProjectMediaStore(projectStore, {
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return new Response('unavailable', { status: 503 });
      return new Response(Buffer.from('downloaded-image'), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      });
    }
  });
  try {
    const project = projectStore.saveProject({ name: 'Media', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const media = await mediaStore.saveProviderImage(project.id, {
      kind: 'url',
      value: 'https://cdn.example.test/result.png'
    });
    assert.equal(calls, 3);
    assert.equal(media.bytes, Buffer.byteLength('downloaded-image'));
    assert.ok(fs.existsSync(mediaStore.resolveFile(project.id, media.id).filePath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('provider video result is saved as a playable project media record', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-video-download-'));
  const projectStore = new ProjectStore({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects') });
  const mediaStore = new ProjectMediaStore(projectStore, {
    fetchImpl: async () => new Response(Buffer.from('video-bytes'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' }
    })
  });
  try {
    const project = projectStore.saveProject({ name: 'Video Media', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const media = await mediaStore.saveProviderVideo(project.id, {
      kind: 'url', value: 'https://cdn.example.test/result.mp4'
    }, { profileId: 'boundless', model: 'seedance-2.5-720p', nodeId: 'video-node', taskId: 'task-1' });
    assert.equal(media.kind, 'video');
    assert.equal(media.mime, 'video/mp4');
    assert.equal(media.source.taskId, 'task-1');
    assert.ok(fs.existsSync(mediaStore.resolveFile(project.id, media.id).filePath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
