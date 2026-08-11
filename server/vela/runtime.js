import crypto from 'node:crypto';
import path from 'node:path';

import { expandJobGroup } from './batch.js';
import { VelaDatabase } from './database.js';
import { EventHub } from './eventHub.js';
import { JobRepository } from './jobRepository.js';
import { ProjectMediaStore } from './mediaStore.js';
import { ProfileRepository } from './profileRepository.js';
import { ProjectStore } from './projectStore.js';
import { WorkflowTemplateStore } from './workflowTemplateStore.js';
import { redactSecrets, safeLogJson } from './redaction.js';
import { ConnectionScheduler } from './scheduler.js';
import { SecretProtector } from './secretProtector.js';
import { OpenAiCompatibleProvider, ProviderError } from '../providers/openAiCompatibleProvider.js';
import { ComfyUiProvider } from '../providers/comfyUiProvider.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MODEL_CACHE_TTL_MS = 30_000;

const endpointHost = (baseUrl) => {
  try { return new URL(baseUrl).host; }
  catch { return String(baseUrl || '').slice(0, 120); }
};

const authenticatedDownloadOptions = (result, profile, apiKey) => {
  if (result?.kind !== 'url' || !apiKey) return {};
  try {
    const resultUrl = new URL(result.value);
    const providerUrl = new URL(profile.baseUrl);
    // Never forward a provider credential to a third-party CDN origin.
    if (resultUrl.origin !== providerUrl.origin) return {};
    return { headers: { Authorization: `Bearer ${apiKey}` } };
  } catch {
    return {};
  }
};

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
    this.workflowTemplates = new WorkflowTemplateStore({ dataDirectory: this.dataDirectory });
    this.database = new VelaDatabase(path.join(this.dataDirectory, 'database', 'vela.sqlite'));
    this.secretProtector = secretProtector || new SecretProtector({
      keyPath: path.join(this.dataDirectory, 'secrets', 'profile-master.key')
    });
    this.profiles = new ProfileRepository(this.database, this.secretProtector);
    this.gptProvider = gptProvider || new OpenAiCompatibleProvider();
    this.gptModelCache = new Map();
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
    let credentials = this.profiles.get(job.profileId);
    const requestId = `gpt-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    try {
      const startingJob = this.jobs.getJob(job.id);
      if (startingJob?.status === 'queued') {
        this.jobs.transition(job.id, 'submitting', { progress: 0 });
      } else if (startingJob?.status !== 'reconnecting') {
        return startingJob;
      }
      credentials = this.profiles.getWithSecret(job.profileId);
      if (!credentials) {
        throw new ProviderError('所选 API 账户不存在，请重新选择账户', { code: 'PROFILE_NOT_FOUND' });
      }
      if (credentials.credentialStatus === 'unreadable') {
        throw new ProviderError(`账户“${credentials.name}”的已保存密钥无法解密，请到 API 设置重新输入 API Key 并保存`, {
          code: 'CREDENTIAL_UNREADABLE',
          details: { profileName: credentials.name, endpointHost: endpointHost(credentials.baseUrl) }
        });
      }
      if (!credentials.secret?.apiKey) {
        throw new ProviderError(`账户“${credentials.name}”尚未保存 API Key`, {
          code: 'CREDENTIAL_MISSING',
          details: { profileName: credentials.name, endpointHost: endpointHost(credentials.baseUrl) }
        });
      }
      await this.assertGptJobModel(credentials, credentials.secret.apiKey, job.payload.nodeKind);
      if (job.payload.nodeKind === 'gpt-video') {
        const imageUrls = Array.isArray(job.payload.referenceUrls)
          ? job.payload.referenceUrls.slice(0, 30).map((url) => {
            if (/^https?:\/\//i.test(String(url))) return String(url);
            const reference = this.media.readReference(job.projectId, url);
            if (!reference.mime.startsWith('image/')) {
              throw new ProviderError('图生视频只支持图片参考素材', { code: 'INVALID_INPUT' });
            }
            return `data:${reference.mime};base64,${reference.data.toString('base64')}`;
          })
          : [];
        const onVideoProgress = async (progress) => {
          const current = this.jobs.getJob(job.id);
          if (current && ['running', 'reconnecting'].includes(current.status)) {
            this.jobs.updateProgress(job.id, 0.1 + (Math.max(0, Math.min(1, Number(progress) || 0)) * 0.75));
          }
        };
        let result;
        if (job.promptId) {
          // A retry with a durable remote task ID must only resume polling.
          // Re-submitting here could create and charge for a duplicate video.
          const current = this.jobs.getJob(job.id);
          if (current && ['submitting', 'reconnecting'].includes(current.status)) {
            this.jobs.transition(job.id, 'running', { promptId: job.promptId, progress: 0.1 });
          }
          result = await this.gptProvider.pollVideoTask(
            credentials,
            credentials.secret.apiKey,
            job.promptId,
            { onProgress: onVideoProgress }
          );
        } else {
          result = await this.gptProvider.generateVideo(credentials, credentials.secret.apiKey, {
            prompt: job.payload.prompt,
            seconds: job.payload.duration,
            ratio: job.payload.aspectRatio,
            resolution: job.payload.resolution,
            imageUrls,
            idempotencyKey: job.id,
            onSubmitted: async (taskId) => {
              const current = this.jobs.getJob(job.id);
              if (current?.status === 'submitting') {
                this.jobs.transition(job.id, 'running', { promptId: taskId, progress: 0.1 });
              }
            },
            onProgress: onVideoProgress
          });
        }
        const current = this.jobs.getJob(job.id);
        if (!current || current.status !== 'running') {
          throw new ProviderError('视频任务状态已改变，已停止下载结果', { code: 'JOB_STATE_CHANGED' });
        }
        this.jobs.transition(job.id, 'downloading', { progress: 0.9 });
        const media = await this.media.saveProviderVideo(job.projectId, result, {
          profileId: job.profileId,
          model: credentials.models.video,
          nodeId: job.nodeId,
          taskId: result.taskId || current.promptId
        }, authenticatedDownloadOptions(result, credentials, credentials.secret.apiKey));
        return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: { media } });
      }
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
        idempotencyKey: job.id,
        // Arbitrary OpenAI-style size and quality values are not portable across relays.
        // Only forward them when a future profile explicitly opts in to native parameters.
        size: job.payload.nativeImageParameters === true ? job.payload.size : undefined,
        quality: job.payload.nativeImageParameters === true ? job.payload.quality : undefined
      };
      const results = referenceImages.length
        ? await this.gptProvider.editImages(credentials, credentials.secret.apiKey, { ...imageInput, referenceImages })
        : await this.gptProvider.generateImages(credentials, credentials.secret.apiKey, imageInput);
      this.jobs.transition(job.id, 'downloading', { progress: 0.8 });
      const media = await this.media.saveProviderImage(job.projectId, results[0], {
        profileId: job.profileId,
        model: credentials.models.image,
        nodeId: job.nodeId
      }, authenticatedDownloadOptions(results[0], credentials, credentials.secret.apiKey));
      return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: { media } });
    } catch (error) {
      const details = redactSecrets({
        ...(error instanceof ProviderError && error.details ? error.details : {}),
        profileName: credentials?.name || job.profileId,
        endpointHost: endpointHost(credentials?.baseUrl),
        model: credentials?.models
          ? job.payload.nodeKind === 'gpt-prompt-optimizer'
            ? credentials.models.prompt
            : job.payload.nodeKind === 'gpt-video'
              ? credentials.models.video
              : credentials.models.image
          : undefined
      });
      const current = this.jobs.getJob(job.id);
      if (current && ['submitting', 'running', 'downloading', 'reconnecting'].includes(current.status)) {
        this.jobs.transition(job.id, 'failed', { error: redactSecrets({
          code: error instanceof ProviderError ? error.code : 'GPT_JOB_FAILED',
          message: error instanceof Error ? error.message : 'GPT 任务失败',
          status: error?.status,
          retryable: Boolean(error?.retryable),
          safeToRetry: Boolean(error?.safeToRetry),
          details
        }) });
      }
      console.error('[Vela GPT] Job failed', safeLogJson({
        jobId: job.id,
        profileId: job.profileId,
        ...details,
        code: error?.code || 'GPT_JOB_FAILED',
        status: error?.status,
        retryable: Boolean(error?.retryable),
        safeToRetry: Boolean(error?.safeToRetry),
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error)
      }));
      throw error;
    }
  }

  async listGptModelsCached(profile, apiKey) {
    const cacheKey = `${profile.id}:${profile.updatedAt || ''}`;
    const existing = this.gptModelCache.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    const promise = Promise.resolve().then(() => this.gptProvider.listModels(profile, apiKey));
    this.gptModelCache.set(cacheKey, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, promise });
    try {
      return await promise;
    } catch (error) {
      this.gptModelCache.delete(cacheKey);
      throw error;
    }
  }

  async assertGptJobModel(profile, apiKey, nodeKind) {
    const modelType = nodeKind === 'gpt-prompt-optimizer' ? 'prompt' : nodeKind === 'gpt-video' ? 'video' : 'image';
    const modelLabel = modelType === 'prompt' ? '提示词' : modelType === 'video' ? '视频' : '图片';
    const model = profile.models?.[modelType];
    if (!model) {
      throw new ProviderError(`账户“${profile.name}”尚未配置${modelLabel}模型`, {
        code: 'MODEL_NOT_CONFIGURED',
        details: { profileName: profile.name, endpointHost: endpointHost(profile.baseUrl), modelType }
      });
    }
    const models = await this.listGptModelsCached(profile, apiKey);
    if (!models.includes(model)) {
      throw new ProviderError(`账户“${profile.name}”的${modelLabel}模型 ${model} 已不在中转站当前模型列表中，请到 API 设置重新测试并更换模型或账户`, {
        code: 'MODEL_NOT_FOUND',
        status: 404,
        details: {
          profileName: profile.name,
          endpointHost: endpointHost(profile.baseUrl),
          modelType,
          missingModels: [model],
          availableModels: models
        }
      });
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
    this.gptModelCache.clear();
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
      if (profile.credentialStatus === 'unreadable') {
        throw new ProviderError(`账户“${profile.name}”的已保存密钥无法解密，请重新输入 API Key 并保存`, {
          code: 'CREDENTIAL_UNREADABLE',
          details: { profileName: profile.name, endpointHost: endpointHost(profile.baseUrl) }
        });
      }
      if (!profile.secret?.apiKey) {
        throw new ProviderError(`账户“${profile.name}”尚未保存 API Key`, {
          code: 'CREDENTIAL_MISSING',
          details: { profileName: profile.name, endpointHost: endpointHost(profile.baseUrl) }
        });
      }
      const result = await this.gptProvider.testConnection(profile, profile.secret.apiKey);
      this.gptModelCache.set(`${profile.id}:${profile.updatedAt || ''}`, {
        expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
        promise: Promise.resolve(result.models)
      });
      return result;
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
      if (
        job.status === 'reconnecting'
        && job.providerType === 'gpt'
        && job.payload?.nodeKind === 'gpt-video'
        && job.promptId
      ) {
        this.scheduler.enqueue(job);
        continue;
      }
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
