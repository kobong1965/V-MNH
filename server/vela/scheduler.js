export class ConnectionScheduler {
  constructor({ executor, onStateChange } = {}) {
    if (typeof executor !== 'function') throw new Error('executor is required');
    this.executor = executor;
    this.onStateChange = onStateChange;
    this.connections = new Map();
    this.queuedJobIds = new Set();
    this.idleWaiters = new Set();
  }

  configureConnection(profileId, { maxConcurrency = 1, online = true } = {}) {
    const current = this.connections.get(profileId) || { queue: [], running: 0 };
    current.maxConcurrency = Math.max(1, Math.min(32, Math.trunc(maxConcurrency) || 1));
    current.online = Boolean(online);
    this.connections.set(profileId, current);
    this.drain(profileId);
  }

  enqueue(job) {
    if (!job?.id || !job?.profileId) throw new Error('job id and profileId are required');
    if (this.queuedJobIds.has(job.id)) return false;
    if (!this.connections.has(job.profileId)) this.configureConnection(job.profileId, { maxConcurrency: 1, online: false });
    const connection = this.connections.get(job.profileId);
    connection.queue.push(job);
    this.queuedJobIds.add(job.id);
    this.onStateChange?.({ type: 'queued', job, profileId: job.profileId });
    this.drain(job.profileId);
    return true;
  }

  cancelQueued(jobId) {
    for (const [profileId, connection] of this.connections) {
      const index = connection.queue.findIndex((job) => job.id === jobId);
      if (index === -1) continue;
      const [job] = connection.queue.splice(index, 1);
      this.queuedJobIds.delete(jobId);
      this.onStateChange?.({ type: 'cancelled', job, profileId });
      this.resolveIdleIfNeeded();
      return true;
    }
    return false;
  }

  async drain(profileId) {
    const connection = this.connections.get(profileId);
    if (!connection || !connection.online) return;
    while (connection.running < connection.maxConcurrency && connection.queue.length > 0) {
      const job = connection.queue.shift();
      this.queuedJobIds.delete(job.id);
      connection.running += 1;
      this.onStateChange?.({ type: 'started', job, profileId });
      Promise.resolve()
        .then(() => this.executor(job))
        .then(
          (result) => this.onStateChange?.({ type: 'completed', job, profileId, result }),
          (error) => this.onStateChange?.({ type: 'failed', job, profileId, error })
        )
        .finally(() => {
          connection.running -= 1;
          this.drain(profileId);
          this.resolveIdleIfNeeded();
        });
    }
  }

  getSummary(profileId) {
    const connection = this.connections.get(profileId);
    return connection ? {
      profileId,
      online: connection.online,
      maxConcurrency: connection.maxConcurrency,
      running: connection.running,
      queued: connection.queue.length
    } : null;
  }

  isIdle() {
    return [...this.connections.values()].every((connection) => connection.running === 0 && connection.queue.length === 0);
  }

  waitForIdle() {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  resolveIdleIfNeeded() {
    if (!this.isIdle()) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
