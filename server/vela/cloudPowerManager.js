const ACTIVE_JOB_STATUSES = new Set([
  'queued',
  'submitting',
  'running',
  'reconnecting',
  'downloading'
]);

const OFF_STATES = new Set(['stopped', 'shutdown', 'shutoff', 'closed', 'poweroff', 'powered-off']);
const RUNNING_STATES = new Set(['running']);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CloudPowerManager {
  constructor({
    powerProvider,
    getProfile,
    listJobs,
    getRemoteQueue,
    onStateChange,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    sleep = delay,
    idleConfirmationDelayMs = 2_000
  } = {}) {
    if (!powerProvider) throw new Error('powerProvider is required');
    if (typeof getProfile !== 'function') throw new Error('getProfile is required');
    if (typeof listJobs !== 'function') throw new Error('listJobs is required');
    if (typeof getRemoteQueue !== 'function') throw new Error('getRemoteQueue is required');
    this.powerProvider = powerProvider;
    this.getProfile = getProfile;
    this.listJobs = listJobs;
    this.getRemoteQueue = getRemoteQueue;
    this.onStateChange = onStateChange;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sleep = sleep;
    this.idleConfirmationDelayMs = Math.max(0, Number(idleConfirmationDelayMs) || 0);
    this.idleTimers = new Map();
    this.wakePromises = new Map();
    this.locks = new Map();
    this.activeWork = new Map();
    this.states = new Map();
    this.closed = false;
  }

  publish(profileId, state, details = {}) {
    const snapshot = {
      profileId,
      state,
      updatedAt: new Date().toISOString(),
      ...details
    };
    this.states.set(profileId, snapshot);
    this.onStateChange?.(snapshot);
    return snapshot;
  }

  getState(profileId) {
    return this.states.get(profileId) || {
      profileId,
      state: 'unknown',
      updatedAt: null
    };
  }

  isEnabled(profile) {
    return Boolean(profile?.type === 'comfy'
      && profile.platform === 'autodl'
      && profile.autoPowerEnabled
      && profile.autoPowerProvider === 'autodl-pro');
  }

  hasLocalWork(profileId) {
    return (this.activeWork.get(profileId)?.size || 0) > 0
      || this.listJobs(profileId).some((job) => ACTIVE_JOB_STATUSES.has(job.status));
  }

  async withProfileLock(profileId, operation) {
    const previous = this.locks.get(profileId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.locks.set(profileId, tail);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(profileId) === tail) this.locks.delete(profileId);
    }
  }

  cancelIdleShutdown(profileId, reason = 'work-arrived') {
    const timer = this.idleTimers.get(profileId);
    if (!timer) return false;
    this.clearTimer(timer.handle);
    this.idleTimers.delete(profileId);
    this.publish(profileId, 'idle-shutdown-cancelled', { reason });
    return true;
  }

  async ensureReady(profileId) {
    if (this.closed) throw new Error('CloudPowerManager is closed');
    this.cancelIdleShutdown(profileId);
    const existing = this.wakePromises.get(profileId);
    if (existing) return existing;
    const operation = this.withProfileLock(profileId, async () => {
      const profile = this.getProfile(profileId);
      if (!this.isEnabled(profile)) return { enabled: false, state: 'unmanaged' };
      if (!profile.secret?.autodlDeveloperToken) {
        throw new Error('AutoDL 自动开机凭据缺失，请到 API/算力页面重新保存 Developer Token');
      }
      this.publish(profileId, 'checking');
      let state = String(await this.powerProvider.getStatus(profile, profile.secret) || 'unknown').toLowerCase();
      if (RUNNING_STATES.has(state)) {
        this.publish(profileId, 'running');
        return { enabled: true, state };
      }
      if (OFF_STATES.has(state)) {
        this.publish(profileId, 'powering-on');
        await this.powerProvider.powerOn(profile, profile.secret);
      } else {
        this.publish(profileId, 'waiting-for-running', { remoteState: state });
      }
      state = await this.powerProvider.waitForState(profile, profile.secret, ['running'], {
        timeoutMs: profile.powerOnTimeoutMs
      });
      this.publish(profileId, 'running');
      return { enabled: true, state };
    });
    this.wakePromises.set(profileId, operation);
    try {
      return await operation;
    } catch (error) {
      this.publish(profileId, 'error', {
        code: error?.code || 'AUTODL_WAKE_FAILED',
        message: error instanceof Error ? error.message : 'AutoDL 自动开机失败'
      });
      throw error;
    } finally {
      if (this.wakePromises.get(profileId) === operation) this.wakePromises.delete(profileId);
    }
  }

  noteWorkStarted(profileId, workId = 'default') {
    const active = this.activeWork.get(profileId) || new Set();
    active.add(String(workId || 'default'));
    this.activeWork.set(profileId, active);
    this.cancelIdleShutdown(profileId);
  }

  noteWorkFinished(profileId, workId = 'default') {
    const active = this.activeWork.get(profileId);
    if (!active) return false;
    active.delete(String(workId || 'default'));
    if (active.size === 0) this.activeWork.delete(profileId);
    return true;
  }

  scheduleIdleShutdown(profileId) {
    if (this.closed) return false;
    this.cancelIdleShutdown(profileId, 'rescheduled');
    const profile = this.getProfile(profileId);
    if (!this.isEnabled(profile) || this.hasLocalWork(profileId)) return false;
    const delayMs = Math.max(60_000, Number(profile.idleShutdownMinutes) * 60_000 || 5 * 60_000);
    const deadlineAt = new Date(Date.now() + delayMs).toISOString();
    const handle = this.setTimer(() => {
      this.idleTimers.delete(profileId);
      void this.powerOffIfStillIdle(profileId).catch((error) => {
        this.publish(profileId, 'error', {
          code: error?.code || 'AUTODL_POWER_OFF_FAILED',
          message: error instanceof Error ? error.message : 'AutoDL 自动关机失败'
        });
      });
    }, delayMs);
    this.idleTimers.set(profileId, { handle, deadlineAt });
    this.publish(profileId, 'idle-countdown', { deadlineAt, idleShutdownMinutes: profile.idleShutdownMinutes });
    return true;
  }

  async powerOffIfStillIdle(profileId) {
    return this.withProfileLock(profileId, async () => {
      const profile = this.getProfile(profileId);
      if (!this.isEnabled(profile)) return { poweredOff: false, reason: 'disabled' };
      if (this.hasLocalWork(profileId)) return { poweredOff: false, reason: 'local-work' };
      const remoteFirst = await this.getRemoteQueue(profile);
      if ((remoteFirst?.running || 0) > 0 || (remoteFirst?.pending || 0) > 0) {
        this.publish(profileId, 'remote-busy', { queue: remoteFirst });
        this.scheduleIdleShutdown(profileId);
        return { poweredOff: false, reason: 'remote-work' };
      }
      if (this.idleConfirmationDelayMs > 0) await this.sleep(this.idleConfirmationDelayMs);
      if (this.hasLocalWork(profileId)) return { poweredOff: false, reason: 'local-work' };
      const remoteSecond = await this.getRemoteQueue(profile);
      if ((remoteSecond?.running || 0) > 0 || (remoteSecond?.pending || 0) > 0) {
        this.publish(profileId, 'remote-busy', { queue: remoteSecond });
        this.scheduleIdleShutdown(profileId);
        return { poweredOff: false, reason: 'remote-work' };
      }
      const currentState = String(await this.powerProvider.getStatus(profile, profile.secret) || 'unknown').toLowerCase();
      if (OFF_STATES.has(currentState)) {
        this.publish(profileId, 'stopped');
        return { poweredOff: false, reason: 'already-stopped' };
      }
      this.publish(profileId, 'powering-off');
      await this.powerProvider.powerOff(profile, profile.secret);
      this.publish(profileId, 'stopped');
      return { poweredOff: true };
    });
  }

  async forcePowerOff(profileId, { reason = 'application-shutdown' } = {}) {
    this.cancelIdleShutdown(profileId, reason);
    return this.withProfileLock(profileId, async () => {
      const profile = this.getProfile(profileId);
      if (!this.isEnabled(profile)) return { poweredOff: false, reason: 'disabled' };
      if (!profile.secret?.autodlDeveloperToken) {
        return { poweredOff: false, reason: 'credential-missing' };
      }
      const currentState = String(await this.powerProvider.getStatus(profile, profile.secret) || 'unknown').toLowerCase();
      if (OFF_STATES.has(currentState)) {
        this.publish(profileId, 'stopped', { reason });
        return { poweredOff: false, reason: 'already-stopped' };
      }
      this.publish(profileId, 'powering-off', { reason, remoteState: currentState });
      await this.powerProvider.powerOff(profile, profile.secret);
      this.activeWork.delete(profileId);
      this.publish(profileId, 'stopped', { reason });
      return { poweredOff: true, reason };
    });
  }

  async test(profileId) {
    const profile = this.getProfile(profileId);
    if (!this.isEnabled(profile)) throw new Error('该算力尚未启用 AutoDL Pro 自动开关机');
    const remoteState = String(await this.powerProvider.getStatus(profile, profile.secret) || 'unknown').toLowerCase();
    this.publish(profileId, RUNNING_STATES.has(remoteState) ? 'running' : OFF_STATES.has(remoteState) ? 'stopped' : 'checking', {
      remoteState
    });
    return { ok: true, profileId, remoteState, checkedAt: new Date().toISOString() };
  }

  close() {
    this.closed = true;
    for (const timer of this.idleTimers.values()) this.clearTimer(timer.handle);
    this.idleTimers.clear();
    this.activeWork.clear();
    this.states.clear();
  }
}
