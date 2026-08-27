import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { VelaDatabase } from '../server/vela/database.js';
import { ProfileRepository } from '../server/vela/profileRepository.js';
import { SecretProtector } from '../server/vela/secretProtector.js';

const [
  dataDirectoryArg,
  corruptDatabaseArg,
  readableBackupArg,
  recoveredDatabaseArg,
  outputDatabaseArg,
  sourceProfileId,
  secondaryProfileId
] = process.argv.slice(2);

if (!dataDirectoryArg || !corruptDatabaseArg || !readableBackupArg || !recoveredDatabaseArg
  || !outputDatabaseArg || !sourceProfileId || !secondaryProfileId) {
  throw new Error('Usage: recover-vela-database.mjs <data-dir> <corrupt-db> <readable-backup-db> <sqlite-recovered-db> <output-db> <source-profile-id> <secondary-profile-id>');
}

const dataDirectory = path.resolve(dataDirectoryArg);
const corruptDatabasePath = path.resolve(corruptDatabaseArg);
const readableBackupPath = path.resolve(readableBackupArg);
const recoveredDatabasePath = path.resolve(recoveredDatabaseArg);
const outputDatabasePath = path.resolve(outputDatabaseArg);

if (fs.existsSync(outputDatabasePath)) {
  throw new Error(`Refusing to overwrite existing recovery output: ${outputDatabasePath}`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

const findJsonEnd = (buffer, start) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b) depth += 1;
    else if (byte === 0x7d) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('Could not find the end of the recovered profile JSON');
};

const recoverComfyProfileRecord = (databaseBuffer, profileId) => {
  const idBytes = Buffer.from(profileId, 'utf8');
  let offset = -1;
  while ((offset = databaseBuffer.indexOf(idBytes, offset + 1)) >= 0) {
    const typeStart = offset + idBytes.length;
    if (databaseBuffer.subarray(typeStart, typeStart + 5).toString('utf8') !== 'comfy') continue;
    const jsonStart = databaseBuffer.indexOf(Buffer.from('{"platform"'), typeStart + 5);
    if (jsonStart < 0 || jsonStart - typeStart > 256) continue;
    const jsonEnd = findJsonEnd(databaseBuffer, jsonStart);
    const publicJson = databaseBuffer.subarray(jsonStart, jsonEnd + 1).toString('utf8');
    JSON.parse(publicJson);
    const tail = databaseBuffer.subarray(jsonEnd + 1, Math.min(databaseBuffer.length, jsonEnd + 1 + 1024));
    const timestampMatch = ISO_PATTERN.exec(tail.toString('latin1'));
    ISO_PATTERN.lastIndex = 0;
    if (!timestampMatch) continue;
    const createdStart = jsonEnd + 1 + timestampMatch.index;
    const encryptedSecret = databaseBuffer.subarray(jsonEnd + 1, createdStart);
    const createdAt = timestampMatch[0];
    const updatedAt = databaseBuffer.subarray(createdStart + createdAt.length, createdStart + createdAt.length + 24).toString('utf8');
    return {
      id: profileId,
      type: 'comfy',
      name: databaseBuffer.subarray(typeStart + 5, jsonStart).toString('utf8'),
      public_json: publicJson,
      encrypted_secret: encryptedSecret,
      created_at: createdAt,
      updated_at: /^\d{4}-\d{2}-\d{2}T/.test(updatedAt) ? updatedAt : createdAt
    };
  }
  throw new Error(`Could not recover ComfyUI profile record: ${profileId}`);
};

const oldDatabase = new DatabaseSync(readableBackupPath, { readOnly: true });
const recoveredDatabase = new DatabaseSync(recoveredDatabasePath, { readOnly: true });
const corruptBuffer = fs.readFileSync(corruptDatabasePath);
const secretProtector = new SecretProtector({
  keyPath: path.join(dataDirectory, 'secrets', 'profile-master.key')
});
const sourceProfile = recoverComfyProfileRecord(corruptBuffer, sourceProfileId);
const recoveredSecret = secretProtector.decrypt(sourceProfile.encrypted_secret);
if (!recoveredSecret?.autodlDeveloperToken) {
  throw new Error('Recovered source profile does not contain an AutoDL Developer Token');
}

const sourceConfig = JSON.parse(sourceProfile.public_json);
const secondaryNow = new Date().toISOString();
const secondaryProfile = {
  id: secondaryProfileId,
  type: 'comfy',
  name: 'AutoDL MiniMax H3 Pro GPU 2',
  public_json: JSON.stringify({
    ...sourceConfig,
    baseUrl: 'http://127.0.0.1:18189',
    websocketUrl: 'ws://127.0.0.1:18189/ws',
    sshHost: 'connect.westd.seetacloud.com',
    sshPort: 32796,
    sshLocalPort: 18189,
    autodlInstanceUuid: 'pro-78724ddf7edf',
    idleShutdownMinutes: 5,
    maxConcurrency: 1,
    tags: ['AutoDL Pro', 'MiniMax H3', 'RTX PRO 6000', 'GPU 2'],
    notes: '第二台 AutoDL MiniMax H3；任务到达自动开机，独立空闲 5 分钟后安全关机。'
  }),
  encrypted_secret: sourceProfile.encrypted_secret,
  created_at: secondaryNow,
  updated_at: secondaryNow
};

const outputDatabase = new VelaDatabase(outputDatabasePath);
const output = outputDatabase.connection;

const insertProfile = output.prepare(`
  INSERT OR REPLACE INTO profiles(id, type, name, public_json, encrypted_secret, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertGroup = output.prepare(`
  INSERT OR IGNORE INTO job_groups(
    id, project_id, node_id, provider_type, profile_id, seed_mode, base_seed,
    total_count, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertJob = output.prepare(`
  INSERT OR IGNORE INTO jobs(
    id, group_id, project_id, node_id, provider_type, profile_id, status,
    payload_json, progress, seed, retry_count, prompt_id, workflow_version,
    error_json, output_json, created_at, updated_at, priority
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertEvent = output.prepare(`
  INSERT OR IGNORE INTO job_events(id, job_id, event_type, data_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

try {
  outputDatabase.transaction(() => {
    const oldProfiles = oldDatabase.prepare('SELECT * FROM profiles ORDER BY rowid').all();
    for (const profile of oldProfiles) {
      if (profile.id === sourceProfileId) continue;
      insertProfile.run(
        profile.id, profile.type, profile.name, profile.public_json,
        profile.encrypted_secret, profile.created_at, profile.updated_at
      );
    }
    for (const profile of [sourceProfile, secondaryProfile]) {
      insertProfile.run(
        profile.id, profile.type, profile.name, profile.public_json,
        profile.encrypted_secret, profile.created_at, profile.updated_at
      );
    }

    const recoveredJobs = recoveredDatabase.prepare('SELECT * FROM jobs ORDER BY created_at, rowid').all();
    const lostJobs = recoveredDatabase.prepare(`
      SELECT c0 AS id, c1 AS group_id, c2 AS project_id, c3 AS node_id,
        c4 AS provider_type, c5 AS profile_id, c6 AS status, c7 AS payload_json,
        c8 AS progress, c9 AS seed, c10 AS retry_count, c11 AS prompt_id,
        c12 AS workflow_version, c13 AS error_json, c14 AS output_json,
        c15 AS created_at, c16 AS updated_at, c17 AS priority
      FROM lost_and_found WHERE nfield = 18
    `).all().filter((job) => UUID_PATTERN.test(String(job.id || '')) && UUID_PATTERN.test(String(job.group_id || '')));
    const jobsById = new Map([...recoveredJobs, ...lostJobs].map((job) => [job.id, job]));
    const groupedJobs = new Map();
    for (const job of jobsById.values()) {
      const groupJobs = groupedJobs.get(job.group_id) || [];
      groupJobs.push(job);
      groupedJobs.set(job.group_id, groupJobs);
    }

    for (const [groupId, jobs] of groupedJobs) {
      jobs.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
      const first = jobs[0];
      const last = jobs[jobs.length - 1];
      insertGroup.run(
        groupId, first.project_id, first.node_id, first.provider_type, first.profile_id,
        'increment', Number(first.seed) || 0, jobs.length, first.created_at, last.updated_at || last.created_at
      );
    }
    for (const job of jobsById.values()) {
      insertJob.run(
        job.id, job.group_id, job.project_id, job.node_id, job.provider_type,
        job.profile_id, job.status, job.payload_json, job.progress, job.seed,
        job.retry_count, job.prompt_id, job.workflow_version, job.error_json,
        job.output_json, job.created_at, job.updated_at, Number(job.priority) || 0
      );
    }

    const events = recoveredDatabase.prepare('SELECT * FROM job_events ORDER BY id').all();
    for (const event of events) {
      if (!jobsById.has(event.job_id)) continue;
      insertEvent.run(event.id, event.job_id, event.event_type, event.data_json, event.created_at);
    }
  });

  const profiles = new ProfileRepository(outputDatabase, secretProtector);
  const source = profiles.getWithSecret(sourceProfileId);
  const secondary = profiles.getWithSecret(secondaryProfileId);
  const integrity = output.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0]);
  const foreignKeyIssues = output.prepare('PRAGMA foreign_key_check').all();
  if (integrity.length !== 1 || integrity[0] !== 'ok' || foreignKeyIssues.length) {
    throw new Error(`Recovery validation failed: integrity=${integrity.join(',')} foreignKeys=${foreignKeyIssues.length}`);
  }
  if (!source?.secret?.autodlDeveloperToken || !secondary?.secret?.autodlDeveloperToken) {
    throw new Error('Recovery validation failed: AutoDL credentials are unreadable');
  }

  console.log(JSON.stringify({
    outputDatabasePath,
    integrity: integrity[0],
    foreignKeyIssues: foreignKeyIssues.length,
    profileCount: output.prepare('SELECT count(*) AS count FROM profiles').get().count,
    groupCount: output.prepare('SELECT count(*) AS count FROM job_groups').get().count,
    jobCount: output.prepare('SELECT count(*) AS count FROM jobs').get().count,
    eventCount: output.prepare('SELECT count(*) AS count FROM job_events').get().count,
    sourceCredentialStatus: source.autoPowerCredentialStatus,
    secondaryCredentialStatus: secondary.autoPowerCredentialStatus
  }));
} finally {
  outputDatabase.close();
  recoveredDatabase.close();
  oldDatabase.close();
}
