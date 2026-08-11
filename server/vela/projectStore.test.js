import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ProjectStore } from './projectStore.js';

const draft = (name = '短视频项目') => ({
  name,
  nodes: [{ id: 'n1', type: 'Text', x: 10, y: 20 }],
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 }
});

const withTemporaryStore = (fn, options = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-project-store-'));
  try {
    return fn(new ProjectStore({ dataDirectory: directory, ...options }), directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('ProjectStore creates the approved directory structure and lists projects', () => {
  withTemporaryStore((store) => {
    const project = store.saveProject(draft());
    const directory = store.findProjectDirectory(project.id);
    assert.ok(fs.existsSync(path.join(directory, 'project.json')));
    assert.ok(fs.existsSync(path.join(directory, 'assets')));
    assert.ok(fs.existsSync(path.join(directory, 'outputs', 'images')));
    assert.equal(store.listProjects()[0].nodeCount, 1);
  });
});

test('ProjectStore exposes a lightweight thumbnail and supports rename and delete', () => {
  withTemporaryStore((store) => {
    const project = store.saveProject({
      ...draft('原项目'),
      nodes: [{ id: 'n1', type: 'Image', x: 10, y: 20, resultUrl: '/api/vela/projects/p/media/m/file' }]
    });
    assert.equal(store.listProjects()[0].thumbnailUrl, '/api/vela/projects/p/media/m/file');

    const renamed = store.renameProject(project.id, '新项目');
    assert.equal(renamed.name, '新项目');
    assert.equal(store.getProject(project.id).name, '新项目');

    assert.equal(store.deleteProject(project.id), true);
    assert.equal(store.getProject(project.id), null);
    assert.equal(store.deleteProject(project.id), false);
  });
});

test('atomic save keeps the previous project when replacement is interrupted', () => {
  withTemporaryStore((store, directory) => {
    const project = store.saveProject(draft('原项目'));
    const failingStore = new ProjectStore({
      dataDirectory: directory,
      hooks: { beforeRename: () => { throw new Error('simulated power loss'); } }
    });
    assert.throws(() => failingStore.saveProject({ ...project, name: '不完整写入' }), /simulated power loss/);
    assert.equal(store.getProject(project.id).name, '原项目');
  });
});

test('ProjectStore retains at most twenty lightweight snapshots', () => {
  withTemporaryStore((store) => {
    let project = store.saveProject(draft());
    for (let index = 0; index < 25; index += 1) {
      project = store.saveProject({ ...project, name: `版本 ${index}` });
    }
    const directory = store.findProjectDirectory(project.id);
    const snapshots = fs.readdirSync(path.join(directory, 'snapshots')).filter((file) => file.endsWith('.json'));
    assert.equal(snapshots.length, 20);
  });
});

test('workflow-only and media exports round-trip with hash verification', () => {
  withTemporaryStore((store) => {
    let project = store.saveProject(draft());
    project = store.saveProject({
      ...project,
      nodes: [{
        id: 'reference',
        type: 'Image',
        x: 10,
        y: 20,
        resultUrl: `/api/vela/projects/${project.id}/media/reference/file`,
        metadata: { nestedUrl: `/api/vela/projects/${project.id}/media/reference/file` }
      }]
    });
    const directory = store.findProjectDirectory(project.id);
    fs.writeFileSync(path.join(directory, 'assets', 'reference.txt'), 'asset-content');
    fs.mkdirSync(path.join(directory, 'inputs', 'images'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'inputs', 'images', 'reference.png'), 'reference-image');
    fs.writeFileSync(path.join(directory, 'media-index.json'), JSON.stringify([{
      id: 'reference',
      projectId: project.id,
      relativePath: 'inputs/images/reference.png',
      mime: 'image/png'
    }]));
    assert.equal(store.exportProject(project.id).media.length, 0);
    const archive = store.exportProject(project.id, { includeMedia: true });
    assert.equal(archive.media.length, 3);
    const imported = store.importProject(archive);
    const importedDirectory = store.findProjectDirectory(imported.id);
    assert.equal(fs.readFileSync(path.join(importedDirectory, 'assets', 'reference.txt'), 'utf8'), 'asset-content');
    assert.equal(fs.readFileSync(path.join(importedDirectory, 'inputs', 'images', 'reference.png'), 'utf8'), 'reference-image');
    const importedMediaIndex = JSON.parse(fs.readFileSync(path.join(importedDirectory, 'media-index.json'), 'utf8'));
    assert.equal(importedMediaIndex[0].projectId, imported.id);
    assert.equal(imported.nodes[0].resultUrl, `/api/vela/projects/${imported.id}/media/reference/file`);
    assert.equal(imported.nodes[0].metadata.nestedUrl, `/api/vela/projects/${imported.id}/media/reference/file`);
    assert.doesNotMatch(imported.nodes[0].resultUrl, new RegExp(project.id));
    const packageBuffer = store.exportProjectPackage(project.id, { includeMedia: true });
    assert.ok(packageBuffer.length > 0);
    const importedFromPackage = store.importProjectPackage(packageBuffer, { name: '压缩包导入' });
    assert.equal(store.getProject(importedFromPackage.id).name, '压缩包导入');
    assert.equal(
      importedFromPackage.nodes[0].resultUrl,
      `/api/vela/projects/${importedFromPackage.id}/media/reference/file`
    );
  });
});

test('a corrupt project recovers from the latest valid snapshot', () => {
  withTemporaryStore((store) => {
    let project = store.saveProject(draft('初始'));
    project = store.saveProject({ ...project, name: '当前版本' });
    const directory = store.findProjectDirectory(project.id);
    fs.writeFileSync(path.join(directory, 'project.json'), '{broken');
    const recovered = store.getProject(project.id);
    assert.equal(recovered.name, '初始');
    assert.equal(store.lastRecovery.projectId, project.id);
  });
});
