import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContractValidationError,
  VELA_SCHEMA_VERSION,
  validateJobGroupDraft,
  validateProjectDocument,
  validatePublicProfile
} from './vela-contracts.js';

const projectFixture = () => ({
  schemaVersion: VELA_SCHEMA_VERSION,
  id: 'project-1',
  name: '测试项目',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  nodes: [{ id: 'node-1', type: 'Text', x: 0, y: 0, profileId: 'gpt-main' }],
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 }
});

test('project contract accepts a versioned secret-free project', () => {
  assert.equal(validateProjectDocument(projectFixture()).id, 'project-1');
});

test('project contract rejects unsupported versions and plaintext secrets', () => {
  assert.throws(
    () => validateProjectDocument({ ...projectFixture(), schemaVersion: 99 }),
    ContractValidationError
  );
  assert.throws(
    () => validateProjectDocument({ ...projectFixture(), apiKey: 'should-never-be-here' }),
    /禁止保存明文凭据/
  );
});

test('public profile exposes configuration state but no secret', () => {
  assert.equal(validatePublicProfile({
    id: 'gpt-main',
    name: '团队 GPT',
    type: 'gpt',
    secretConfigured: true
  }).name, '团队 GPT');

  assert.throws(() => validatePublicProfile({
    id: 'gpt-main',
    name: '团队 GPT',
    type: 'gpt',
    secretConfigured: true,
    token: 'plain'
  }), /禁止保存明文凭据/);
});

test('job group contract enforces the approved batch boundary', () => {
  assert.equal(validateJobGroupDraft({ projectId: 'p', nodeId: 'n', count: 50, seedMode: 'random' }).count, 50);
  assert.throws(
    () => validateJobGroupDraft({ projectId: 'p', nodeId: 'n', count: 51, seedMode: 'random' }),
    /1-50/
  );
});
