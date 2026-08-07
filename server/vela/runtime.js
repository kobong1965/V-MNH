import crypto from 'node:crypto';
import path from 'node:path';

import { expandJobGroup } from './batch.js';
import { VelaDatabase } from './database.js';
import { EventHub } from './eventHub.js';
import { JobRepository } from './jobRepository.js';
import { ProjectMediaStore } from './mediaStore.js';
import { ProfileRepository } from './profileRepository.js';
import { ProjectStore } from './projectStore.js';
import { redactSecrets } from './redaction.js';
import { ConnectionScheduler } from './scheduler.js';
import { SecretProtector } from './secretProtector.js';
import { OpenAiCompatibleProvider, ProviderError } from '../providers/openAiCompatibleProvider.js';
import { ComfyUiProvider } from '../providers/comfyUiProvider.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class VelaRuntime {
  constructor({
    dataDirectory,
    projectsDirectory,
    fakeStepDelay = 20,
    secretProtector,
    gptProvider,
    comfyProvider,
    mediaFetch
  } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.dataDirectory = path.resolve(dataDirectory);
    this.eventHub = new EventHub();
    this.projectStore = new ProjectStore({ dataDirectory: this.dataDirectory, projectsDirectory });
    this.database = new VelaDatabase(path.join(this.dataDirectory, 'database', 'vela.sqlite'));
    this.secretProtector = secretProtector || new SecretProtector({
      keyPath: path.join(this.dataDirectory, 'secrets', 'profile-master.key')
    });
    this.profiles = new ProfileRepository(this.database, this.secretProtector);
    this.gptProvider = gptProvider || new OpenAiCompatibleProvider();
    this.comfyProvider = comfyProvider || new ComfyUiProvider();
    this.media = new ProjectMediaStore(this.projectStore, { fetchImpl: mediaFetch });
    this.jobs = new JobRepository(this.database, {
      onEvent: (event) => this.eventHub.publish(redactSecrets(event))
    });
    this.fakeStepDelay = fakeStepDelay;
    this.scheduler = new ConnectionScheduler({
      executor: (job) => this.executeJob(job),
      onStateChange: (event) => this.eventHub.publish(redactSecrets({
        type: `scheduler.${event.type}`,
        jobId: event.job.id,
        profileId: event.profileId
      }))
    });
    this.scheduler.configureConnection('fake-local', { maxConcurrency: 2, online: true });
    for (const profile of this.profiles.list()) {
      this.scheduler.configureConnection(profile.id, {
        maxConcurrency: profile.maxConcurrency,
        online: profile.type === 'gpt'
      });
    }
    this.recover();
  }

  async executeJob(job) {
    if (job.providerType === 'gpt') return this.executeGptJob(job);
    if (job.providerType !== 'fake') throw new Error(`Provider ${job.providerType} is not available`);
    const move = async (from, to, patch) => {
      const current = this.jobs.getJob(job.id);
      if (!current || current.status !== from) return false;
      this.jobs.transition(job.id, to, patch);
      await delay(this.fakeStepDelay);
      return true;
    };
    if (!await move('queued', 'submitting', { progress: 0 })) return;
    if (!await move('submitting', 'running', { promptId: `fake-${crypto.randomUUID()}`, progress: 0.2 })) return;
    if (!await move('running', 'downloading', { progress: 0.9 })) return;
    await move('downloading', 'succeeded', {
      progress: 1,
      output: { previewOnly: true, label: `P2 fake output ${job.id}` }
    });
  }

  async executeGptJob(job) {
    const credentials = this.profiles.getWithSecret(job.profileId);
    if (!credentials?.secret?.apiKey) throw new Error(`GPT Profile not configured: ${job.profileId}`);
    const requestId = `gpt-${crypto.randomUUID()}`;
    try {
      this.jobs.transition(job.id, 'submitting', { progress: 0 });
      this.jobs.transition(job.id, 'running', { promptId: requestId, progress: 0.1 });
      if (job.payload.nodeKind === 'gpt-prompt-optimizer') {
        const reference = job.payload.referenceUrls?.[0]
          ? this.media.readReference(job.projectId, job.payload.referenceUrls[0])
          : null;
        const optimized = await this.gptProvider.optimizePrompt(credentials, credentials.secret.apiKey, {
          prompt: job.payload.prompt,
          imageDataUrl: reference ? `data:${reference.mime};base64,${reference.data.toString('base64')}` : undefined
        });
        this.jobs.transition(job.id, 'downloading', { progress: 0.95 });
        return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: optimized });
      }
      const referenceImages = Array.isArray(job.payload.referenceUrls)
        ? job.payload.referenceUrls.map((url) => this.media.readReference(job.projectId, url))
        : [];
      const imageInput = {
        prompt: job.payload.prompt,
        count: 1,
        size: job.payload.size,
        quality: job.payload.quality
      };
      const results = referenceImages.length
        ? await this.gptProvider.editImages(credentials, credentials.secret.apiKey, { ...imageInput, referenceImages })
        : await this.gptProvider.generateImages(credentials, credentials.secret.apiKey, imageInput);
      this.jobs.transition(job.id, 'downloading', { progress: 0.8 });
      const media = await this.media.saveProviderImage(job.projectId, results[0], {
        profileId: job.profileId,
        model: credentials.models.image,
        nodeId: job.nodeId
      });
      return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: { media } });
    } catch (error) {
      const current = this.jobs.getJob(job.id);
      if (current && ['submitting', 'running', 'downloading', 'reconnecting'].includes(current.status)) {
        this.jobs.transition(job.id, 'failed', { error: redactSecrets({
          code: error instanceof ProviderError ? error.code : 'GPT_JOB_FAILED',
          message: error instanceof Error ? error.message : 'GPT 任务失败',
          retryable: Boolean(error?.retryable),
          safeToRetry: Boolean(error?.safeToRetry)
        }) });
      }
      throw error;
    }
  }

  createProfile(draft) {
    const profile = this.profiles.create(draft);
    this.scheduler.configureConnection(profile.id, {
      maxConcurrency: profile.maxConcurrency,
      online: profile.type === 'gpt'
    });
    return profile;
  }

  updateProfile(id, patch) {
    const profile = this.profiles.update(id, patch);
    this.scheduler.configureConnection(profile.id, {
      maxConcurrency: profile.maxConcurrency,
      online: profile.type === 'gpt'
    });
    return profile;
  }

  async testProfile(id) {
    const profile = this.profiles.getWithSecret(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    if (profile.type === 'gpt') {
      if (!profile.secret?.apiKey) throw new Error(`Profile missing API key: ${id}`);
      return this.gptProvider.testConnection(profile, profile.secret.apiKey);
    }
    const result = await this.comfyProvider.testConnection(profile, profile.secret || {});
    this.scheduler.configureConnection(profile.id, { maxConcurrency: profile.maxConcurrency, online: true });
    return result;
  }

  async getComfyStatus(id) {
    const profile = this.profiles.getWithSecret(id);
    if (!profile || profile.type !== 'comfy') throw new Error(`ComfyUI Profile not found: ${id}`);
    try {
      const result = await this.comfyProvider.getStatus(profile, profile.secret || {});
      this.scheduler.configureConnection(profile.id, { maxConcurrency: profile.maxConcurrency, online: true });
      return result;
    } catch (error) {
      this.scheduler.configureConnection(profile.id, { maxConcurrency: profile.maxConcurrency, online: false });
      throw error;
    }
  }

  createJobGroup(draft) {
    const expanded = expandJobGroup(draft);
    const group = this.jobs.createGroup(expanded.group, expanded.jobs);
    const jobs = expanded.jobs.map((job) => this.jobs.getJob(job.id));
    for (const job of jobs) this.scheduler.enqueue(job);
    return { group, jobs };
  }

  retryJob(jobId) {
    const job = this.jobs.retry(jobId);
    this.scheduler.enqueue(job);
    return job;
  }

  cancelJob(jobId) {
    const job = this.jobs.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'queued') this.scheduler.cancelQueued(jobId);
    if (!['queued', 'running', 'reconnecting'].includes(job.status)) {
      throw new Error(`Job ${job.status} cannot be cancelled`);
    }
    return this.jobs.transition(jobId, 'cancelled');
  }

  retryFailedGroup(groupId) {
    const failed = this.jobs.listJobs({ groupId, limit: 2000 }).filter((job) => job.status === 'failed');
    return failed.map((job) => this.retryJob(job.id));
  }

  recover() {
    const jobs = this.jobs.recoverAfterRestart();
    for (const job of jobs) {
      if (job.status === 'queued') {
        if (job.profileId === 'fake-local') this.scheduler.enqueue(job);
        else this.scheduler.configureConnection(job.profileId, { maxConcurrency: 1, online: false });
      }
    }
    return jobs;
  }

  close() {
    this.database.close();
  }
}
