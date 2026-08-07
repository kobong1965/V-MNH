export const DATABASE_SCHEMA_VERSION = 2;

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial-task-store',
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('gpt', 'comfy')),
        name TEXT NOT NULL,
        public_json TEXT NOT NULL DEFAULT '{}',
        encrypted_secret BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_groups (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        seed_mode TEXT NOT NULL,
        base_seed INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES job_groups(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        progress REAL,
        seed INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        prompt_id TEXT,
        workflow_version TEXT,
        error_json TEXT,
        output_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_profile_status ON jobs(profile_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_group ON jobs(group_id, created_at);

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'job-priority',
    sql: `
      ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_jobs_queue_order ON jobs(profile_id, status, priority DESC, created_at);
    `
  }
];
