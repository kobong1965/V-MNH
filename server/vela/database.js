import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

const LOCK_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 500, 500, 500];
const LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));
const isDatabaseLockError = (error) => /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || error));
const sleepSync = (milliseconds) => Atomics.wait(LOCK_SLEEP, 0, 0, milliseconds);

export class VelaDatabase {
  constructor(databasePath) {
    if (!databasePath) throw new Error('databasePath is required');
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.databasePath = databasePath;
    this.connection = new DatabaseSync(databasePath);
    this.executeWithLockRetry(() => this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'));
    if (databasePath !== ':memory:') {
      this.executeWithLockRetry(() => this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;'));
    }
    this.migrate();
  }

  executeWithLockRetry(operation) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return operation();
      } catch (error) {
        if (!isDatabaseLockError(error) || attempt >= LOCK_RETRY_DELAYS_MS.length) throw error;
        sleepSync(LOCK_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  migrate() {
    this.executeWithLockRetry(() => this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `));
    for (const migration of MIGRATIONS) {
      this.transaction(() => {
        const applied = this.connection.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
        if (applied) return;
        this.connection.exec(migration.sql);
        this.connection.prepare(
          'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, new Date().toISOString());
      });
    }
  }

  get schemaVersion() {
    return this.connection.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  }

  assertCurrentVersion() {
    if (this.schemaVersion !== DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema ${this.schemaVersion} does not match ${DATABASE_SCHEMA_VERSION}`);
    }
  }

  transaction(operation) {
    for (let attempt = 0; ; attempt += 1) {
      let began = false;
      try {
        this.connection.exec('BEGIN IMMEDIATE');
        began = true;
        const result = operation();
        this.connection.exec('COMMIT');
        return result;
      } catch (error) {
        if (began) {
          try { this.connection.exec('ROLLBACK'); }
          catch { /* Preserve the original operation error. */ }
        }
        if (!isDatabaseLockError(error) || attempt >= LOCK_RETRY_DELAYS_MS.length) throw error;
        sleepSync(LOCK_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  close() {
    try {
      if (this.databasePath !== ':memory:') {
        this.executeWithLockRetry(() => this.connection.exec('PRAGMA wal_checkpoint(TRUNCATE);'));
      }
    } finally {
      this.connection.close();
    }
  }
}
