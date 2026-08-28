import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { VelaDatabase } from './database.js';
import { DATABASE_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

test('a new database migrates to the current schema', () => {
  const database = new VelaDatabase(':memory:');
  try {
    assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
    assert.doesNotThrow(() => database.connection.prepare('SELECT priority FROM jobs LIMIT 1').all());
    assert.doesNotThrow(() => database.connection.prepare('SELECT external_key, contract_fingerprint FROM job_groups LIMIT 1').all());
    assert.equal(
      database.connection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_job_groups_external_key'").get().count,
      1
    );
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
    try {
      assert.equal(upgraded.schemaVersion, DATABASE_SCHEMA_VERSION);
      assert.equal(upgraded.connection.prepare('SELECT priority FROM jobs WHERE id = ?').get('j1').priority, 0);
      const upgradedGroup = upgraded.connection.prepare('SELECT external_key, contract_fingerprint FROM job_groups WHERE id = ?').get('g1');
      assert.equal(upgradedGroup.external_key, null);
      assert.equal(upgradedGroup.contract_fingerprint, null);
    } finally {
      upgraded.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('closing a persistent database checkpoints and truncates its WAL', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-db-checkpoint-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  try {
    const database = new VelaDatabase(databasePath);
    database.connection.exec('CREATE TABLE checkpoint_probe(value TEXT NOT NULL);');
    database.connection.prepare('INSERT INTO checkpoint_probe(value) VALUES (?)').run('durable');
    database.close();

    const walPath = `${databasePath}-wal`;
    assert.ok(!fs.existsSync(walPath) || fs.statSync(walPath).size === 0);
    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(reopened.prepare('SELECT value FROM checkpoint_probe').get().value, 'durable');
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('concurrent processes migrate one database without duplicate rows or database locked', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-db-concurrent-migrate-'));
  const databasePath = path.join(directory, 'vela.sqlite');
  const moduleUrl = pathToFileURL(path.resolve('server/vela/database.js')).href;
  const startAt = Date.now() + 250;
  const source = `
    import { VelaDatabase } from ${JSON.stringify(moduleUrl)};
    const wait = Math.max(0, Number(process.argv[2]) - Date.now());
    await new Promise(resolve => setTimeout(resolve, wait));
    const database = new VelaDatabase(process.argv[1]);
    database.assertCurrentVersion();
    database.close();
  `;
  try {
    const children = Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, databasePath, String(startAt)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`migration child exited ${code}: ${stderr}`)));
    }));
    await Promise.all(children);
    const database = new VelaDatabase(databasePath);
    try {
      assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
      const rows = database.connection.prepare('SELECT version, COUNT(*) AS count FROM schema_migrations GROUP BY version ORDER BY version').all();
      assert.deepEqual(rows.map((row) => Number(row.version)), MIGRATIONS.map((migration) => migration.version));
      assert.ok(rows.every((row) => Number(row.count) === 1));
    } finally { database.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
