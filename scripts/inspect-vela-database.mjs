import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [databasePathArg] = process.argv.slice(2);
if (!databasePathArg) throw new Error('Usage: inspect-vela-database.mjs <database-path>');

const databasePath = path.resolve(databasePathArg);
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const integrity = database.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0]);
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  const counts = {};
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/i.test(table)) continue;
    counts[table] = Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count) || 0;
  }
  const profileSummaries = [];
  if (tables.includes('profiles')) {
    const readProfile = database.prepare(`
      SELECT rowid, id, type, name, length(encrypted_secret) AS encryptedBytes, created_at, updated_at
      FROM profiles NOT INDEXED WHERE rowid = ?
    `);
    for (let rowid = 1; rowid <= 128; rowid += 1) {
      try {
        const profile = readProfile.get(rowid);
        if (profile) profileSummaries.push(profile);
      } catch {
        profileSummaries.push({ rowid, unreadable: true });
      }
    }
  }
  console.log(JSON.stringify({ databasePath, integrity, counts, profileSummaries }));
} finally {
  database.close();
}
