import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { ProjectMediaStore } from './mediaStore.js';
import { ProjectStore } from './projectStore.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('provider result download retries transient GET failures before saving the image', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-media-download-'));
  let calls = 0;
  const projectStore = new ProjectStore({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects') });
  const mediaStore = new ProjectMediaStore(projectStore, {
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return new Response('unavailable', { status: 503 });
      return new Response(PNG, {
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
    assert.equal(media.bytes, PNG.length);
    assert.ok(fs.existsSync(mediaStore.resolveFile(project.id, media.id).filePath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('provider image formats outside the sync contract are normalized to PNG', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-media-normalize-'));
  const gif = await sharp(PNG).gif().toBuffer();
  const projectStore = new ProjectStore({ dataDirectory: directory, projectsDirectory: path.join(directory, 'projects') });
  const mediaStore = new ProjectMediaStore(projectStore, {
    fetchImpl: async () => new Response(gif, { status: 200, headers: { 'Content-Type': 'image/gif' } })
  });
  try {
    const project = projectStore.saveProject({ name: 'Media', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const media = await mediaStore.saveProviderImage(project.id, { kind: 'url', value: 'https://cdn.example.test/result.gif' });
    assert.equal(media.mime, 'image/png');
    assert.equal(path.extname(media.relativePath), '.png');
    assert.deepEqual(fs.readFileSync(mediaStore.resolveFile(project.id, media.id).filePath).subarray(0, 8), PNG.subarray(0, 8));
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
