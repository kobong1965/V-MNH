import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { VelaDatabase } from './database.js';
import { DATABASE_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

test('a new database migrates to the current schema', () => {
  const database = new VelaDatabase(':memory:');
  try {
    assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.doesNotThrow(() => database.connection.prepare('SELECT priority FROM jobs LIMIT 1').all());
  } finally {
    database.close();
  }
});

test('a version one fixture upgrades without losing its existing jobs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-db-migrate-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
    legacy.exec(MIGRATIONS[0].sql);
    legacy.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run('initial-task-store', new Date(0).toISOString());
    legacy.prepare(`INSERT INTO job_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('g1', 'p1', 'n1', 'fake', 'local', 'fixed', 1, 1, new Date(0).toISOString(), new Date(0).toISOString());
    legacy.prepare(`
      INSERT INTO jobs(id, group_id, project_id, node_id, provider_type, profile_id, status, payload_json, seed, created_at, updated_at)
      VALUES ('j1', 'g1', 'p1', 'n1', 'fake', 'local', 'queued', '{}', 1, ?, ?)
    `).run(new Date(0).toISOString(), new Date(0).toISOString());
    legacy.close();

    const upgraded = new VelaDatabase(databasePath);
    assert.equal(upgraded.schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.equal(upgraded.connection.prepare('SELECT priority FROM jobs WHERE id = ?').get('j1').priority, 0);
    upgraded.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
