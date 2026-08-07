import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

export class VelaDatabase {
  constructor(databasePath) {
    if (!databasePath) throw new Error('databasePath is required');
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.databasePath = databasePath;
    this.connection = new DatabaseSync(databasePath);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.migrate();
  }

  migrate() {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version)
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
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
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.connection.close();
  }
}
