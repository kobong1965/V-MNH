import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VelaRuntime } from './runtime.js';
import { SecretProtector } from './secretProtector.js';

const makeRuntime = (directory, keyByte) => new VelaRuntime({
  dataDirectory: directory,
  projectsDirectory: path.join(directory, 'projects'),
  secretProtector: new SecretProtector({ key: Buffer.alloc(32, keyByte) }),
  comfyProvider: { close: () => {} }
});

test('portable backup encrypts profiles, SSH key, projects and media for another machine', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-portable-'));
  const sourceDirectory = path.join(root, 'source');
  const targetDirectory = path.join(root, 'target');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const privateKeyPath = path.join(sourceDirectory, 'id_ed25519');
  fs.writeFileSync(privateKeyPath, 'PRIVATE-KEY-CONTENT', { mode: 0o600 });
  const source = makeRuntime(sourceDirectory, 1);
  const target = makeRuntime(targetDirectory, 2);
  try {
    source.createProfile({
      id: 'gpt-portable', type: 'gpt', name: 'GPT Relay', baseUrl: 'https://relay.example.test/v1',
      apiKey: 'sk-portable-secret', models: { prompt: 'gpt-5', image: 'gpt-image-1', video: '', analysis: '' }
    });
    source.createProfile({
      id: 'wan-portable', type: 'comfy', name: 'Wan AutoDL', platform: 'autodl',
      baseUrl: 'http://127.0.0.1:18188', transport: 'ssh', sshHost: 'gpu.example.test',
      sshPrivateKeyPath: privateKeyPath, authType: 'none', maxConcurrency: 1
    });
    const project = source.projectStore.saveProject({ name: '迁移项目', nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } });
    source.media.saveUploadedMedia(project.id, {
      dataUrl: `data:image/png;base64,${Buffer.from('portable-image').toString('base64')}`,
      fileName: 'product.png'
    });
    source.ecommerceWorkflows.delete('kontext-photo-restore');

    const backup = source.portableBackup.export('correct-horse-123');
    const envelopeText = backup.toString('utf8');
    assert.doesNotMatch(envelopeText, /sk-portable-secret|PRIVATE-KEY-CONTENT|gpu\.example\.test/);
    assert.throws(() => target.portableBackup.import(backup, 'wrong-password'), /密码错误|已损坏/);

    const restored = target.portableBackup.import(backup, 'correct-horse-123');
    assert.deepEqual(restored, { profiles: 2, projects: 1, projectIds: restored.projectIds });
    assert.equal(target.profiles.getWithSecret('gpt-portable').secret.apiKey, 'sk-portable-secret');
    const wan = target.profiles.getWithSecret('wan-portable');
    assert.match(wan.sshPrivateKeyPath, /portable-keys/);
    assert.equal(fs.readFileSync(wan.sshPrivateKeyPath, 'utf8'), 'PRIVATE-KEY-CONTENT');
    assert.equal(target.projectStore.listProjects().length, 1);
    assert.equal(target.media.list(restored.projectIds[0]).length, 1);
    assert.equal(target.ecommerceWorkflows.list().some((workflow) => workflow.id === 'kontext-photo-restore'), false);
  } finally {
    source.close();
    target.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
