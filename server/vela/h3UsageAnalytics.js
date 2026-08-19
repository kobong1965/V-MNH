const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const GPU_ACTIVE_STATUSES = new Set(['running', 'reconnecting']);
const ACTIVE_JOB_STATUSES = new Set(['queued', 'submitting', 'running', 'reconnecting', 'downloading']);
const RESOLUTION_ORDER = ['480p', '720p', '1080p', '2K'];
const PRESET_ORDER = ['turbo-4', 'turbo-8', 'standard'];

const parseJson = (value, fallback = null) => {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
};

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const nextShanghaiDateKey = (dateKey) => {
  const start = Date.parse(`${dateKey}T00:00:00+08:00`);
  return new Date(start + 24 * 60 * 60 * 1000 + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
};

export const getShanghaiDayWindow = ({ now = new Date(), dateKey } = {}) => {
  const resolvedDateKey = dateKey || new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDateKey)) throw new Error('dateKey must use YYYY-MM-DD');
  const from = new Date(`${resolvedDateKey}T00:00:00+08:00`);
  if (Number.isNaN(from.getTime())) throw new Error('dateKey is invalid');
  return {
    dateKey: resolvedDateKey,
    timezone: 'Asia/Shanghai',
    from: from.toISOString(),
    to: new Date(`${nextShanghaiDateKey(resolvedDateKey)}T00:00:00+08:00`).toISOString()
  };
};

const createBucket = (key) => ({
  key,
  successfulVideos: 0,
  failedVideos: 0,
  activeVideos: 0,
  generatedSeconds: 0,
  gpuSeconds: 0,
  estimatedCostYuan: 0
});

const finalizeBucket = (bucket) => ({
  ...bucket,
  generatedSeconds: round(bucket.generatedSeconds, 1),
  gpuSeconds: round(bucket.gpuSeconds, 1),
  estimatedCostYuan: round(bucket.estimatedCostYuan, 2)
});

const gpuSecondsForEvents = (events, nowIso) => {
  let activeStartedAt = null;
  let totalMilliseconds = 0;
  for (const event of events) {
    const transition = parseJson(event.data_json, {});
    const wasActive = GPU_ACTIVE_STATUSES.has(transition.from);
    const isActive = GPU_ACTIVE_STATUSES.has(transition.to);
    if (!wasActive && isActive && !activeStartedAt) activeStartedAt = event.created_at;
    if (wasActive && !isActive && activeStartedAt) {
      totalMilliseconds += Math.max(0, Date.parse(event.created_at) - Date.parse(activeStartedAt));
      activeStartedAt = null;
    }
  }
  if (activeStartedAt) totalMilliseconds += Math.max(0, Date.parse(nowIso) - Date.parse(activeStartedAt));
  return totalMilliseconds / 1000;
};

const orderedBuckets = (map, preferredOrder) => {
  const order = new Map(preferredOrder.map((key, index) => [key, index]));
  return [...map.values()]
    .sort((left, right) => (order.get(left.key) ?? 999) - (order.get(right.key) ?? 999) || left.key.localeCompare(right.key))
    .map(finalizeBucket);
};

export class H3UsageAnalytics {
  constructor(database) {
    this.db = database.connection;
  }

  getDailySummary({ from, to, now = new Date().toISOString(), profileId, hourlyRateYuan = 7.97 } = {}) {
    if (!from || !to) throw new Error('from and to are required');
    const clauses = ['created_at >= ?', 'created_at < ?'];
    const values = [from, to];
    if (profileId) {
      clauses.push('profile_id = ?');
      values.push(profileId);
    }
    const rows = this.db.prepare(`
      SELECT id, profile_id, status, payload_json, created_at, updated_at
      FROM jobs
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ASC
    `).all(...values);
    const eventStatement = this.db.prepare(`
      SELECT data_json, created_at
      FROM job_events
      WHERE job_id = ? AND event_type = 'status-changed'
      ORDER BY created_at ASC
    `);
    const byResolution = new Map(RESOLUTION_ORDER.map((key) => [key, createBucket(key)]));
    const byPreset = new Map(PRESET_ORDER.map((key) => [key, createBucket(key)]));
    const summary = {
      successfulVideos: 0,
      failedVideos: 0,
      activeVideos: 0,
      generatedSeconds: 0,
      gpuSeconds: 0,
      estimatedCostYuan: 0,
      successfulCostYuan: 0,
      failedCostYuan: 0,
      activeCostYuan: 0
    };

    for (const row of rows) {
      const payload = parseJson(row.payload_json, {});
      if (payload?.nodeKind !== 'h3-video') continue;
      const resolutionKey = String(payload.resolution || '其他');
      const presetKey = String(payload.h3Acceleration || '未设置');
      if (!byResolution.has(resolutionKey)) byResolution.set(resolutionKey, createBucket(resolutionKey));
      if (!byPreset.has(presetKey)) byPreset.set(presetKey, createBucket(presetKey));
      const buckets = [byResolution.get(resolutionKey), byPreset.get(presetKey)];
      const isSuccessful = row.status === 'succeeded';
      const isFailed = row.status === 'failed';
      const isActive = ACTIVE_JOB_STATUSES.has(row.status);
      const generatedSeconds = isSuccessful ? Math.max(0, Number(payload.duration) || 0) : 0;
      const gpuSeconds = gpuSecondsForEvents(eventStatement.all(row.id), now);
      const estimatedCostYuan = gpuSeconds * Math.max(0, Number(hourlyRateYuan) || 0) / 3600;

      summary.successfulVideos += isSuccessful ? 1 : 0;
      summary.failedVideos += isFailed ? 1 : 0;
      summary.activeVideos += isActive ? 1 : 0;
      summary.generatedSeconds += generatedSeconds;
      summary.gpuSeconds += gpuSeconds;
      summary.estimatedCostYuan += estimatedCostYuan;
      summary.successfulCostYuan += isSuccessful ? estimatedCostYuan : 0;
      summary.failedCostYuan += isFailed ? estimatedCostYuan : 0;
      summary.activeCostYuan += isActive ? estimatedCostYuan : 0;

      for (const bucket of buckets) {
        bucket.successfulVideos += isSuccessful ? 1 : 0;
        bucket.failedVideos += isFailed ? 1 : 0;
        bucket.activeVideos += isActive ? 1 : 0;
        bucket.generatedSeconds += generatedSeconds;
        bucket.gpuSeconds += gpuSeconds;
        bucket.estimatedCostYuan += estimatedCostYuan;
      }
    }

    return {
      summary: {
        ...summary,
        generatedSeconds: round(summary.generatedSeconds, 1),
        gpuSeconds: round(summary.gpuSeconds, 1),
        estimatedCostYuan: round(summary.estimatedCostYuan, 2),
        successfulCostYuan: round(summary.successfulCostYuan, 2),
        failedCostYuan: round(summary.failedCostYuan, 2),
        activeCostYuan: round(summary.activeCostYuan, 2)
      },
      byResolution: orderedBuckets(byResolution, RESOLUTION_ORDER),
      byPreset: orderedBuckets(byPreset, PRESET_ORDER)
    };
  }
}
