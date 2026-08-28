import crypto from 'node:crypto';
import path from 'node:path';

import { expandJobGroup } from './batch.js';
import { VelaDatabase } from './database.js';
import { EventHub } from './eventHub.js';
import { JobGroupContractConflictError, JobRepository } from './jobRepository.js';
import { assertExternalH3ContractFingerprint } from './externalJobContract.js';
import { getShanghaiDayWindow, H3UsageAnalytics } from './h3UsageAnalytics.js';
import { ProjectMediaStore } from './mediaStore.js';
import { ProfileRepository } from './profileRepository.js';
import { ProjectStore } from './projectStore.js';
import { WorkflowTemplateStore } from './workflowTemplateStore.js';
import { EcommerceWorkflowStore } from './ecommerceWorkflowStore.js';
import { redactSecrets, safeLogJson } from './redaction.js';
import { ConnectionScheduler } from './scheduler.js';
import { SecretProtector } from './secretProtector.js';
import {
  OpenAiCompatibleProvider,
  ProviderError,
  selectLatestFlagshipGptModel
} from '../providers/openAiCompatibleProvider.js';
import { buildComfyAuthHeaders, ComfyUiError, ComfyUiProvider } from '../providers/comfyUiProvider.js';
import { AutoDlPowerProvider } from '../providers/autodlPowerProvider.js';
import {
  buildMiniMaxH3Prompt,
  MINIMAX_H3_MODEL_FILES
} from '../providers/minimaxH3Workflow.js';
import { CloudPowerManager } from './cloudPowerManager.js';
import { injectWanWorkflowInputs } from './wanWorkflowRuntime.js';
import { PortableBackupService } from './portableBackup.js';
import {
  AUTO_COMFY_PROFILE_ID,
  validateExternalJobContract,
  validateExternalJobKey
} from '../../shared/vela-contracts.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MODEL_CACHE_TTL_MS = 30_000;
const CLOUD_OFF_STATES = new Set(['stopped', 'shutdown', 'shutoff', 'closed', 'poweroff', 'powered-off']);

const isMiniMaxH3Profile = (profile) => profile?.type === 'comfy' && (
  String(profile.workflowVersion || '').toLowerCase().startsWith('minimax-h3')
  || (Array.isArray(profile.tags) && profile.tags.some((tag) => /minimax\s*h3/i.test(String(tag))))
);

const gptModelTypeForNodeKind = (nodeKind) => {
  if (['gpt-prompt-optimizer', 'video-director'].includes(nodeKind)) return 'prompt';
  if (nodeKind === 'competitor-script-analyzer') return 'analysis';
  if (nodeKind === 'gpt-video') return 'video';
  return 'image';
};

const gptModelLabel = (modelType) => ({
  prompt: '提示词',
  analysis: 'Qwen 分析',
  video: '视频',
  image: '图片'
}[modelType] || '模型');

const endpointHost = (baseUrl) => {
  try { return new URL(baseUrl).host; }
  catch { return String(baseUrl || '').slice(0, 120); }
};

const withH3PictureTags = (prompt, count) => {
  const value = String(prompt || '').trim();
  const missing = Array.from({ length: count }, (_, index) => index + 1)
    .filter((number) => !value.includes(`<Picture ${number}>`));
  if (!missing.length) return value;
  const legend = missing.map((number) => `<Picture ${number}> is reference material ${number}; preserve its identity and appearance.`).join('\n');
  return `${legend}\n\n${value || 'Create a coherent cinematic shot using every reference material.'}`;
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
    powerProvider,
    powerManager,
    mediaFetch
  } = {}) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.dataDirectory = path.resolve(dataDirectory);
    this.eventHub = new EventHub();
    this.projectStore = new ProjectStore({ dataDirectory: this.dataDirectory, projectsDirectory });
    this.ecommerceWorkflows = new EcommerceWorkflowStore({
      dataDirectory: this.dataDirectory,
      projectStore: this.projectStore
    });
    this.media = new ProjectMediaStore(this.projectStore, { fetchImpl: mediaFetch });
    this.workflowTemplates = new WorkflowTemplateStore({
      dataDirectory: this.dataDirectory,
      projectMediaStore: this.media
    });
    this.database = new VelaDatabase(path.join(this.dataDirectory, 'database', 'vela.sqlite'));
    this.secretProtector = secretProtector || new SecretProtector({
      keyPath: path.join(this.dataDirectory, 'secrets', 'profile-master.key')
    });
    this.profiles = new ProfileRepository(this.database, this.secretProtector);
    this.portableBackup = new PortableBackupService({
      dataDirectory: this.dataDirectory,
      projectStore: this.projectStore,
      profileRepository: this.profiles,
      ecommerceWorkflowStore: this.ecommerceWorkflows
    });
    this.gptProvider = gptProvider || new OpenAiCompatibleProvider();
    this.gptModelCache = new Map();
    this.comfyProvider = comfyProvider || new ComfyUiProvider();
    this.jobs = new JobRepository(this.database, {
      onEvent: (event) => this.eventHub.publish(redactSecrets(event))
    });
    this.h3UsageAnalytics = new H3UsageAnalytics(this.database);
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
        online: true
      });
    }
    this.powerProvider = powerProvider || new AutoDlPowerProvider();
    this.powerManager = powerManager || new CloudPowerManager({
      powerProvider: this.powerProvider,
      getProfile: (profileId) => this.profiles.getWithSecret(profileId),
      listJobs: (profileId) => this.jobs.listJobs({ profileId, limit: 2_000 }),
      getRemoteQueue: async (profile) => {
        const status = await this.comfyProvider.getStatus(profile, profile.secret || {});
        return status.queue || { running: 0, pending: 0 };
      },
      refreshProfileConnection: async (profile) => {
        if (profile.transport !== 'ssh' || typeof this.powerProvider.getSnapshot !== 'function') return profile;
        const snapshot = await this.powerProvider.getSnapshot(profile, profile.secret || {});
        const sshHost = String(snapshot?.proxy_host || '').trim();
        const sshPort = Math.max(0, Number(snapshot?.ssh_port) || 0);
        if (!sshHost || !sshPort || (sshHost === profile.sshHost && sshPort === profile.sshPort)) return profile;
        return this.profiles.update(profile.id, { sshHost, sshPort });
      },
      onStateChange: (state) => {
        const event = redactSecrets({ type: 'cloud-power.state', ...state });
        console.info('[Vela Cloud Power]', safeLogJson(event));
        this.eventHub.publish(event);
      }
    });
    this.recover();
  }

  async executeJob(job) {
    if (this.failJobForMissingProject(job)) return this.jobs.getJob(job.id);
    if (job.providerType === 'gpt') return this.executeGptJob(job);
    if (job.providerType === 'comfy') return this.executeComfyJob(job);
    if (job.providerType !== 'fake') throw new Error(`Provider ${job.providerType} is not available`);
    const move = async (from, to, patch) => {
      const current = this.jobs.getJob(job.id);
      if (!current || current.status !== from) return false;
      this.jobs.transition(job.id, to, patch);
      await delay(this.fakeStepDelay);
      return true;
    };
    if (!await move('queued', 'preparing', { progress: 0 })) return;
    if (!await move('preparing', 'submitting', { progress: 0.05 })) return;
    if (!await move('submitting', 'running', { promptId: `fake-${crypto.randomUUID()}`, progress: 0.2 })) return;
    if (!await move('running', 'downloading', { progress: 0.9 })) return;
    await move('downloading', 'succeeded', {
      progress: 1,
      output: { previewOnly: true, label: `P2 fake output ${job.id}` }
    });
  }

  failJobForMissingProject(job) {
    if (!['gpt', 'comfy'].includes(job.providerType)) return false;
    if (this.projectStore.getProject(job.projectId)) return false;
    let current = this.jobs.getJob(job.id);
    if (!current || !['queued', 'preparing', 'submitting', 'running', 'reconnecting', 'downloading'].includes(current.status)) return true;
    if (current.status === 'queued') current = this.jobs.transition(job.id, 'preparing', { progress: 0 });
    if (['preparing', 'submitting', 'running', 'reconnecting', 'downloading'].includes(current.status)) {
      this.jobs.transition(job.id, 'failed', {
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: '任务所属项目已不存在；为避免云端计算完成后无法保存，任务未继续执行。',
          retryable: false,
          safeToRetry: false
        }
      });
    }
    if (job.providerType === 'comfy') this.powerManager.noteWorkFinished(job.profileId, job.id);
    return true;
  }

  async executeGptJob(job) {
    let credentials = this.profiles.get(job.profileId);
    let resolvedModel;
    let submissionAttempted = false;
    const requestId = `gpt-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    const beginSubmission = () => {
      const current = this.jobs.getJob(job.id);
      if (current?.status !== 'preparing') throw new Error(`Job ${job.id} is not ready to submit`);
      this.jobs.transition(job.id, 'submitting', { progress: 0.05 });
      submissionAttempted = true;
    };
    const markSynchronousResponse = () => {
      const current = this.jobs.getJob(job.id);
      if (current?.status === 'submitting') {
        this.jobs.transition(job.id, 'running', { promptId: requestId, progress: 0.75 });
      }
    };
    try {
      const startingJob = this.jobs.getJob(job.id);
      if (startingJob?.status === 'queued') {
        this.jobs.transition(job.id, 'preparing', { progress: 0 });
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
      resolvedModel = await this.assertGptJobModel(credentials, credentials.secret.apiKey, job.payload.nodeKind);
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
          if (current && ['preparing', 'submitting', 'reconnecting'].includes(current.status)) {
            this.jobs.transition(job.id, 'running', { promptId: job.promptId, progress: 0.1 });
          }
          result = await this.gptProvider.pollVideoTask(
            credentials,
            credentials.secret.apiKey,
            job.promptId,
            { onProgress: onVideoProgress }
          );
        } else {
          beginSubmission();
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
          const submittedJob = this.jobs.getJob(job.id);
          if (submittedJob?.status === 'submitting' && result?.taskId) {
            this.jobs.transition(job.id, 'running', { promptId: result.taskId, progress: 0.75 });
          }
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
      if (job.payload.nodeKind === 'gpt-prompt-optimizer') {
        const reference = job.payload.referenceUrls?.[0]
          ? this.media.readReference(job.projectId, job.payload.referenceUrls[0])
          : null;
        beginSubmission();
        const optimized = await this.gptProvider.optimizePrompt(credentials, credentials.secret.apiKey, {
          prompt: job.payload.prompt,
          imageDataUrl: reference ? `data:${reference.mime};base64,${reference.data.toString('base64')}` : undefined
        });
        markSynchronousResponse();
        this.jobs.transition(job.id, 'downloading', { progress: 0.95 });
        return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: optimized });
      }
      if (job.payload.nodeKind === 'video-director') {
        const productImageDataUrls = (job.payload.referenceUrls || []).slice(0, 8).map((url) => {
          const reference = this.media.readReference(job.projectId, url);
          if (!reference.mime.startsWith('image/')) {
            throw new ProviderError('视频编导只支持产品图片素材', { code: 'INVALID_INPUT' });
          }
          return `data:${reference.mime};base64,${reference.data.toString('base64')}`;
        });
        beginSubmission();
        const scripted = await this.gptProvider.generateDirectorScript(credentials, credentials.secret.apiKey, {
          brief: job.payload.sourceBrief || job.payload.prompt,
          persona: job.payload.directorPersona,
          productImageDataUrls,
          model: resolvedModel
        });
        markSynchronousResponse();
        this.jobs.transition(job.id, 'downloading', { progress: 0.95 });
        return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: scripted });
      }
      if (job.payload.nodeKind === 'competitor-script-analyzer') {
        const toImageDataUrls = (urls, limit) => (Array.isArray(urls) ? urls : []).slice(0, limit).map((url) => {
          const reference = this.media.readReference(job.projectId, url);
          if (!reference.mime.startsWith('image/')) {
            throw new ProviderError('Qwen 竞品分析只接受图片抽帧和产品图', { code: 'INVALID_INPUT' });
          }
          return `data:${reference.mime};base64,${reference.data.toString('base64')}`;
        });
        beginSubmission();
        const analyzed = await this.gptProvider.analyzeCompetitorScript(credentials, credentials.secret.apiKey, {
          brief: job.payload.sourceBrief || job.payload.prompt,
          competitorFrameDataUrls: toImageDataUrls(job.payload.competitorFrameUrls, 12),
          productImageDataUrls: toImageDataUrls(job.payload.referenceUrls, 8)
        });
        markSynchronousResponse();
        this.jobs.transition(job.id, 'downloading', { progress: 0.95 });
        return this.jobs.transition(job.id, 'succeeded', { progress: 1, output: analyzed });
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
      beginSubmission();
      const results = referenceImages.length
        ? await this.gptProvider.editImages(credentials, credentials.secret.apiKey, { ...imageInput, referenceImages })
        : await this.gptProvider.generateImages(credentials, credentials.secret.apiKey, imageInput);
      markSynchronousResponse();
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
        model: resolvedModel || (credentials?.models
          ? credentials.models[gptModelTypeForNodeKind(job.payload.nodeKind)]
          : undefined)
      });
      const current = this.jobs.getJob(job.id);
      if (current && ['preparing', 'submitting', 'running', 'downloading', 'reconnecting'].includes(current.status)) {
        const submissionUncertain = submissionAttempted && current.status === 'submitting' && !current.promptId;
        this.jobs.transition(job.id, submissionUncertain ? 'submission_uncertain' : 'failed', { error: redactSecrets(submissionUncertain ? {
          code: 'SUBMISSION_UNCERTAIN',
          message: '付费请求已发送，但本机未持久化到远程任务 ID。为避免重复扣费，该任务已停止且不能重提。',
          retryable: false,
          safeToRetry: false,
          details
        } : {
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

  resolveH3OutpaintProfile(profileId) {
    const imageProfiles = this.profiles.list({ type: 'gpt' })
      .filter((candidate) => Boolean(candidate.models?.image))
      .sort((left, right) => {
        const leftPreferred = /gpt-image/i.test(left.models.image) ? 0 : 1;
        const rightPreferred = /gpt-image/i.test(right.models.image) ? 0 : 1;
        return leftPreferred - rightPreferred || left.name.localeCompare(right.name);
      });
    const selected = profileId
      ? imageProfiles.find((candidate) => candidate.id === profileId)
      : imageProfiles[0];
    if (!selected) {
      throw new ComfyUiError('参考图比例与视频比例不一致。请先配置一个支持图片编辑的 GPT 图片账户，用于自动补全画面后再生成视频。', {
        code: 'H3_OUTPAINT_PROFILE_REQUIRED'
      });
    }
    const credentials = this.profiles.getWithSecret(selected.id);
    if (credentials?.credentialStatus === 'unreadable') {
      throw new ComfyUiError(`扩图账户“${selected.name}”的密钥无法解密，请到 API 设置重新保存。`, {
        code: 'H3_OUTPAINT_CREDENTIAL_UNREADABLE'
      });
    }
    if (!credentials?.secret?.apiKey) {
      throw new ComfyUiError(`扩图账户“${selected.name}”尚未保存 API Key。`, {
        code: 'H3_OUTPAINT_PROFILE_REQUIRED'
      });
    }
    return credentials;
  }

  async executeComfyJob(job) {
    let profile = this.profiles.get(job.profileId);
    let submissionAttempted = false;
    const startedAt = Date.now();
    try {
      const startingJob = this.jobs.getJob(job.id);
      if (startingJob?.status === 'queued') {
        this.jobs.transition(job.id, 'preparing', { progress: 0 });
      } else if (startingJob?.status !== 'reconnecting') {
        return startingJob;
      }
      profile = this.profiles.getWithSecret(job.profileId);
      if (!profile || profile.type !== 'comfy') {
        throw new ComfyUiError('所选云端 ComfyUI 算力不存在，请重新选择', { code: 'PROFILE_NOT_FOUND' });
      }
      if (profile.credentialStatus === 'unreadable' && profile.authType !== 'none') {
        throw new ComfyUiError(`算力“${profile.name}”的连接凭据无法解密，请到 API 页面重新保存`, {
          code: 'CREDENTIAL_UNREADABLE'
        });
      }

      this.powerManager.noteWorkStarted(job.profileId, job.id);
      await this.powerManager.ensureReady(job.profileId);
      profile = this.profiles.getWithSecret(job.profileId);
      await this.comfyProvider.ensureServiceReady?.(profile, profile.secret || {});

      const isWanWorkflow = job.payload?.nodeKind === 'wan-video-process';
      const comfyModel = isWanWorkflow ? `wan2.2-animate:${job.payload?.ecommerceWorkflowId || 'unknown'}` : MINIMAX_H3_MODEL_FILES.diffusion;
      let promptId = job.promptId;
      let clientId;
      const warnings = [];
      if (!promptId) {
        let graph;
        if (isWanWorkflow) {
          const workflowId = String(job.payload?.ecommerceWorkflowId || '');
          const definition = this.ecommerceWorkflows.catalog.getRuntimeDefinition(workflowId);
          if (!definition || definition.engine !== 'wan-video-process') {
            throw new ComfyUiError('指定的 Wan 后端工作流不存在，请从首页重新创建', { code: 'WORKFLOW_NOT_FOUND' });
          }
          const payloadInputs = Array.isArray(job.payload?.workflowInputs) ? job.payload.workflowInputs : [];
          const payloadByRole = new Map(payloadInputs.map((input) => [String(input?.role || ''), input]));
          const uploadedInputs = [];
          for (const contract of definition.inputs) {
            const input = payloadByRole.get(contract.role);
            if (!input?.url) {
              throw new ComfyUiError(`缺少 Wan 输入：${contract.label}`, { code: 'WORKFLOW_INPUT_MISSING' });
            }
            if (input.kind !== contract.kind) {
              throw new ComfyUiError(`Wan 输入“${contract.label}”素材类型不正确`, { code: 'WORKFLOW_INPUT_TYPE_INVALID' });
            }
            const reference = this.media.readReference(job.projectId, input.url);
            if (!reference.mime.startsWith(`${contract.kind}/`)) {
              throw new ComfyUiError(`Wan 输入“${contract.label}”不是${contract.kind === 'video' ? '视频' : '图片'}文件`, { code: 'WORKFLOW_INPUT_TYPE_INVALID' });
            }
            const remotePath = await this.comfyProvider.uploadMedia(profile, profile.secret || {}, {
              data: reference.data,
              mime: reference.mime,
              filename: `${job.id}-${contract.role}-${reference.filename}`,
              subfolder: `vela/${job.id}`
            });
            uploadedInputs.push({ role: contract.role, kind: contract.kind, remotePath });
          }
          const uiWorkflow = this.ecommerceWorkflows.catalog.loadBackendWorkflow(workflowId);
          const injectedWorkflow = injectWanWorkflowInputs({ workflow: uiWorkflow, definition, uploadedInputs });
          graph = await this.comfyProvider.convertWorkflow(profile, profile.secret || {}, injectedWorkflow);
        } else {
          const referenceUrls = Array.isArray(job.payload.referenceUrls) ? job.payload.referenceUrls.filter(Boolean) : [];
          const requiredReferenceCount = Number(job.payload.requiredReferenceCount || referenceUrls.length);
          if (referenceUrls.length < 1) {
            throw new ComfyUiError('MiniMax H3 R2V 至少需要连接 1 张参考图片', { code: 'H3_R2V_REFERENCE_REQUIRED' });
          }
          if (referenceUrls.length > 9) {
            throw new ComfyUiError('MiniMax H3 R2V 最多支持 9 张参考图片，请拆分镜头', { code: 'H3_R2V_REFERENCE_LIMIT' });
          }
          if (requiredReferenceCount !== referenceUrls.length) {
            throw new ComfyUiError(`H3 R2V 素材不完整：需要 ${requiredReferenceCount} 张，实际收到 ${referenceUrls.length} 张`, { code: 'H3_R2V_REFERENCE_INCOMPLETE' });
          }
          const references = referenceUrls.map((url) => this.media.readReference(job.projectId, url));
          const uploaded = [];
          for (const [index, reference] of references.entries()) {
            if (!reference.mime.startsWith('image/')) {
              throw new ComfyUiError(`MiniMax H3 R2V 的第 ${index + 1} 个素材不是图片`, { code: 'INVALID_INPUT' });
            }
            uploaded.push(await this.comfyProvider.uploadImage(profile, profile.secret || {}, {
              data: reference.data,
              mime: reference.mime,
              filename: `${job.id}-r2v-${index + 1}-${reference.filename}`
            }));
          }
          graph = buildMiniMaxH3Prompt({
            prompt: withH3PictureTags(job.payload.prompt, uploaded.length),
            seed: job.seed,
            duration: job.payload.duration,
            aspectRatio: job.payload.aspectRatio,
            resolution: job.payload.resolution,
            acceleration: job.payload.h3Acceleration,
            upscale: job.payload.h3Upscale,
            upscaleQuality: job.payload.h3UpscaleQuality,
            referenceImages: uploaded,
            referenceImageSize: job.payload.h3ReferenceImageSize,
            filenamePrefix: `vela/minimax-h3-${job.id}`
          });
        }
        const prepared = this.jobs.getJob(job.id);
        if (prepared?.status !== 'preparing') return prepared;
        this.jobs.transition(job.id, 'submitting', { progress: 0.05 });
        submissionAttempted = true;
        const submitted = await this.comfyProvider.submitPrompt(profile, profile.secret || {}, graph);
        promptId = submitted.promptId;
        clientId = submitted.clientId;
        const current = this.jobs.getJob(job.id);
        if (current?.status === 'submitting') {
          this.jobs.transition(job.id, 'running', { promptId, progress: 0.1 });
        }
      } else {
        const current = this.jobs.getJob(job.id);
        if (current && ['preparing', 'submitting', 'reconnecting'].includes(current.status)) {
          this.jobs.transition(job.id, 'running', { promptId, progress: Math.max(0.1, current.progress || 0) });
        }
      }

      const history = await this.comfyProvider.waitForPrompt(profile, profile.secret || {}, promptId, {
        clientId,
        onProgress: (progress) => {
          const current = this.jobs.getJob(job.id);
          if (current && ['running', 'reconnecting'].includes(current.status)) {
            this.jobs.updateProgress(job.id, 0.1 + Math.max(0, Math.min(1, Number(progress) || 0)) * 0.75);
          }
        }
      });
      const current = this.jobs.getJob(job.id);
      if (!current || current.status !== 'running') {
        throw new ComfyUiError('ComfyUI 任务状态已改变，已停止下载结果', { code: 'JOB_STATE_CHANGED', safeToRetry: true });
      }
      const output = this.comfyProvider.findVideoOutput(history, isWanWorkflow ? [] : ['16']);
      const result = { kind: 'url', value: this.comfyProvider.createViewUrl(profile, output), taskId: promptId };
      this.jobs.transition(job.id, 'downloading', { progress: 0.9 });
      const media = await this.media.saveProviderVideo(job.projectId, result, {
        profileId: job.profileId,
        model: comfyModel,
        nodeId: job.nodeId,
        taskId: promptId
      }, { headers: buildComfyAuthHeaders(profile, profile.secret || {}) });
      return this.jobs.transition(job.id, 'succeeded', {
        progress: 1,
        output: { media, ...(warnings.length ? { warnings } : {}) }
      });
    } catch (error) {
      const current = this.jobs.getJob(job.id);
      const details = redactSecrets({
        ...(error instanceof ComfyUiError && error.details ? error.details : {}),
        profileName: profile?.name || job.profileId,
        endpointHost: endpointHost(profile?.baseUrl),
        transport: profile?.transport,
        model: job.payload?.nodeKind === 'wan-video-process'
          ? `wan2.2-animate:${job.payload?.ecommerceWorkflowId || 'unknown'}`
          : MINIMAX_H3_MODEL_FILES.diffusion
      });
      if (current && ['preparing', 'submitting', 'running', 'downloading', 'reconnecting'].includes(current.status)) {
        const submissionUncertain = submissionAttempted && current.status === 'submitting' && !current.promptId;
        this.jobs.transition(job.id, submissionUncertain ? 'submission_uncertain' : 'failed', { error: redactSecrets(submissionUncertain ? {
          code: 'SUBMISSION_UNCERTAIN',
          message: '提交请求已发送，但本机未持久化到远程任务 ID。为避免重复扣费，该任务已停止且不能自动或手动重提。',
          retryable: false,
          safeToRetry: false,
          details: {
            ...details,
            causeCode: error instanceof ComfyUiError ? error.code : 'COMFY_JOB_FAILED'
          }
        } : {
          code: error instanceof ComfyUiError ? error.code : 'COMFY_JOB_FAILED',
          message: error instanceof Error ? error.message : 'ComfyUI 任务失败',
          status: error?.status,
          retryable: Boolean(error?.retryable),
          safeToRetry: Boolean(error?.safeToRetry || (!current.promptId && error?.retryable)),
          details
        }) });
      }
      console.error('[Vela ComfyUI] Job failed', safeLogJson({
        jobId: job.id,
        profileId: job.profileId,
        code: error?.code || 'COMFY_JOB_FAILED',
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
        ...details
      }));
      throw error;
    } finally {
      this.powerManager.noteWorkFinished(job.profileId, job.id);
      this.powerManager.scheduleIdleShutdown(job.profileId);
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
    const modelType = gptModelTypeForNodeKind(nodeKind);
    const modelLabel = gptModelLabel(modelType);
    const configuredModel = profile.models?.[modelType];
    const models = await this.listGptModelsCached(profile, apiKey);
    if (nodeKind === 'video-director') {
      const latestFlagship = selectLatestFlagshipGptModel(models);
      if (latestFlagship) return latestFlagship;
    }
    if (!configuredModel) {
      throw new ProviderError(`账户“${profile.name}”尚未配置${modelLabel}模型`, {
        code: 'MODEL_NOT_CONFIGURED',
        details: { profileName: profile.name, endpointHost: endpointHost(profile.baseUrl), modelType }
      });
    }
    if (!models.includes(configuredModel)) {
      throw new ProviderError(`账户“${profile.name}”的${modelLabel}模型 ${configuredModel} 已不在中转站当前模型列表中，请到 API 设置重新测试并更换模型或账户`, {
        code: 'MODEL_NOT_FOUND',
        status: 404,
        details: {
          profileName: profile.name,
          endpointHost: endpointHost(profile.baseUrl),
          modelType,
          missingModels: [configuredModel],
          availableModels: models
        }
      });
    }
    return configuredModel;
  }

  createProfile(draft) {
    const profile = this.profiles.create(draft);
    this.scheduler.configureConnection(profile.id, {
      maxConcurrency: profile.maxConcurrency,
      online: true
    });
    if (profile.type === 'comfy') this.powerManager.scheduleIdleShutdown(profile.id);
    return profile;
  }

  updateProfile(id, patch) {
    const profile = this.profiles.update(id, patch);
    this.gptModelCache.clear();
    this.scheduler.configureConnection(profile.id, {
      maxConcurrency: profile.maxConcurrency,
      online: true
    });
    if (profile.type === 'comfy') this.powerManager.scheduleIdleShutdown(profile.id);
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
    if (this.powerManager.isEnabled?.(profile)) {
      const power = await this.powerManager.test(profile.id);
      const remoteState = String(power?.remoteState || 'unknown').toLowerCase();
      if (CLOUD_OFF_STATES.has(remoteState)) {
        return {
          ok: true,
          type: 'comfy',
          state: 'offline',
          baseUrl: profile.baseUrl,
          websocketUrl: profile.websocketUrl || '',
          websocket: { ok: false, url: profile.websocketUrl || '' },
          http: { systemStats: false, queue: false },
          system: {
            os: null,
            pythonVersion: null,
            deviceCount: 0,
            gpu: null
          },
          queue: {
            running: 0,
            pending: 0,
            total: 0,
            maxConcurrency: profile.maxConcurrency,
            full: false
          },
          power: {
            managed: true,
            remoteState
          },
          checkedAt: power.checkedAt || new Date().toISOString()
        };
      }
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

  getCloudPowerState(id) {
    const profile = this.profiles.get(id);
    if (!profile || profile.type !== 'comfy') throw new Error(`ComfyUI Profile not found: ${id}`);
    return this.powerManager.getState(id);
  }

  testCloudPower(id) {
    return this.powerManager.test(id);
  }

  async getCloudAccountOverview() {
    const profiles = this.profiles.list({ type: 'comfy' }).filter((profile) => profile.platform === 'autodl');
    const publicProfile = profiles.find((profile) => profile.autoPowerCredentialStatus === 'ready') || profiles[0];
    if (!publicProfile) {
      return {
        configured: false,
        provider: 'autodl',
        message: '尚未配置 AutoDL 算力账户'
      };
    }

    const profile = this.profiles.getWithSecret(publicProfile.id);
    if (!profile?.secret?.autodlDeveloperToken) {
      return {
        configured: false,
        provider: 'autodl',
        profileId: publicProfile.id,
        profileName: publicProfile.name,
        message: profile?.credentialStatus === 'unreadable'
          ? 'AutoDL Developer Token 无法解密，请到 API/算力页面重新保存'
          : '请在 AutoDL 算力账户中保存 Developer Token'
      };
    }

    const [balanceResult, repositoryResult] = await Promise.allSettled([
      this.powerProvider.getWalletBalance(profile, profile.secret),
      this.powerProvider.listPrivateImages(profile, profile.secret, { pageSize: 12 })
    ]);
    const warnings = [];
    const toYuan = (value) => Math.round((Number(value) || 0) * 100) / 100000;
    const balance = balanceResult.status === 'fulfilled'
      ? {
        availableYuan: toYuan(balanceResult.value?.assets),
        voucherYuan: toYuan(balanceResult.value?.voucher_balance),
        accumulatedYuan: toYuan(balanceResult.value?.accumulate)
      }
      : null;
    if (balanceResult.status === 'rejected') warnings.push(balanceResult.reason?.message || '账号余额读取失败');

    const rawRepository = repositoryResult.status === 'fulfilled' ? repositoryResult.value : null;
    const repository = rawRepository
      ? {
        total: Math.max(0, Number(rawRepository.result_total) || 0),
        items: (Array.isArray(rawRepository.list) ? rawRepository.list : []).slice(0, 12).map((item) => ({
          id: String(item?.image_uuid || ''),
          name: String(item?.name || '未命名镜像'),
          status: String(item?.status || 'unknown'),
          sizeBytes: Math.max(0, Number(item?.image_size) || 0),
          createdAt: item?.create_at ? String(item.create_at) : null
        }))
      }
      : null;
    if (repositoryResult.status === 'rejected') warnings.push(repositoryResult.reason?.message || '个人仓库读取失败');

    return {
      configured: true,
      provider: 'autodl',
      profileId: publicProfile.id,
      profileName: publicProfile.name,
      balance,
      repository,
      warnings,
      updatedAt: new Date().toISOString()
    };
  }

  async getDataDashboardOverview({ now = new Date() } = {}) {
    const generatedAt = now.toISOString();
    const day = getShanghaiDayWindow({ now });
    const account = await this.getCloudAccountOverview();
    const usage = this.h3UsageAnalytics.getDailySummary({
      from: day.from,
      to: day.to,
      now: generatedAt,
      profileId: account.profileId,
      hourlyRateYuan: 7.97
    });
    return {
      generatedAt,
      date: day.dateKey,
      timezone: day.timezone,
      hourlyRateYuan: 7.97,
      account: {
        configured: account.configured,
        provider: account.provider,
        profileId: account.profileId,
        profileName: account.profileName,
        message: account.message,
        balance: account.balance,
        warnings: account.warnings || [],
        updatedAt: account.updatedAt
      },
      ...usage
    };
  }

  createJobGroup(draft) {
    this.jobs.assertNodeSubmissionSafe(draft?.projectId, draft?.nodeId);
    const resolvedDraft = this.resolveJobProfile(draft);
    const expanded = expandJobGroup(resolvedDraft);
    const group = this.jobs.createGroup(expanded.group, expanded.jobs);
    const jobs = expanded.jobs.map((job) => this.jobs.getJob(job.id));
    for (const job of jobs) {
      if (job.providerType === 'comfy') this.powerManager.noteWorkStarted(job.profileId, job.id);
      this.scheduler.enqueue(job);
    }
    return { group, jobs };
  }

  createOrGetJobGroup(externalKey, contractFingerprint, draft) {
    validateExternalJobContract({ externalKey, contractFingerprint });
    const normalizedDraft = assertExternalH3ContractFingerprint(draft, contractFingerprint);

    const existing = this.jobs.getGroupByExternalKey(externalKey);
    if (existing) {
      const conflicts = existing.contractFingerprint !== contractFingerprint
        || existing.projectId !== normalizedDraft.projectId
        || existing.nodeId !== normalizedDraft.nodeId
        || existing.providerType !== normalizedDraft.providerType;
      if (conflicts) throw new JobGroupContractConflictError(externalKey);
      return {
        created: false,
        group: existing,
        jobs: this.jobs.listJobs({ groupId: existing.id, limit: 1 })
      };
    }

    this.jobs.assertNodeSubmissionSafe(normalizedDraft.projectId, normalizedDraft.nodeId);
    const resolvedDraft = this.resolveJobProfile(normalizedDraft);
    const expanded = expandJobGroup(resolvedDraft);
    expanded.group.externalKey = externalKey;
    expanded.group.contractFingerprint = contractFingerprint;
    const result = this.jobs.createOrGetExternalGroup(expanded.group, expanded.jobs);
    if (result.created) {
      for (const job of result.jobs) {
        if (job.providerType === 'comfy') this.powerManager.noteWorkStarted(job.profileId, job.id);
        this.scheduler.enqueue(job);
      }
    }
    return result;
  }

  getJobGroupByExternalKey(externalKey) {
    validateExternalJobKey(externalKey);
    return this.jobs.getExternalGroupBundle(externalKey);
  }

  resolveJobProfile(draft) {
    if (draft?.profileId !== AUTO_COMFY_PROFILE_ID) return draft;
    if (draft.providerType !== 'comfy' || draft.payload?.nodeKind !== 'h3-video') {
      throw new Error('自动算力分配仅支持 MiniMax H3 视频节点');
    }
    const candidates = this.profiles.list({ type: 'comfy' })
      .filter(isMiniMaxH3Profile)
      .map((profile) => {
        const summary = this.scheduler.getSummary(profile.id);
        return {
          profile,
          load: Math.max(0, Number(summary?.running) || 0) + Math.max(0, Number(summary?.queued) || 0)
        };
      })
      .sort((left, right) => left.load - right.load || left.profile.name.localeCompare(right.profile.name));
    if (candidates.length === 0) {
      throw new Error('尚未配置可用的 MiniMax H3 ComfyUI 算力');
    }
    return { ...draft, profileId: candidates[0].profile.id };
  }

  retryJob(jobId) {
    const job = this.jobs.retry(jobId);
    if (job.providerType === 'comfy') this.powerManager.noteWorkStarted(job.profileId, job.id);
    this.scheduler.enqueue(job);
    return job;
  }

  cancelJob(jobId) {
    const job = this.jobs.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'queued') this.scheduler.cancelQueued(jobId);
    if (!['queued', 'preparing', 'running', 'reconnecting'].includes(job.status)) {
      throw new Error(`Job ${job.status} cannot be cancelled`);
    }
    const cancelled = this.jobs.transition(jobId, 'cancelled');
    if (job.providerType === 'comfy') {
      this.powerManager.noteWorkFinished(job.profileId, job.id);
      this.powerManager.scheduleIdleShutdown(job.profileId);
    }
    return cancelled;
  }

  retryFailedGroup(groupId) {
    const group = this.jobs.getGroup(groupId);
    if (!group) throw new Error(`Job group not found: ${groupId}`);
    this.jobs.assertNodeSubmissionSafe(group.projectId, group.nodeId);
    const failed = this.jobs.listJobs({ groupId, limit: 2000 }).filter((job) => job.status === 'failed');
    return failed.map((job) => this.retryJob(job.id));
  }

  recover() {
    const jobs = this.jobs.recoverAfterRestart();
    for (const job of jobs) {
      if (this.failJobForMissingProject(job)) continue;
      if (
        job.status === 'reconnecting'
        && ['gpt', 'comfy'].includes(job.providerType)
        && ['gpt-video', 'h3-video', 'wan-video-process'].includes(job.payload?.nodeKind)
        && job.promptId
      ) {
        if (job.providerType === 'comfy') this.powerManager.noteWorkStarted(job.profileId, job.id);
        this.scheduler.enqueue(job);
        continue;
      }
      if (job.status === 'queued') {
        if (job.providerType === 'comfy') this.powerManager.noteWorkStarted(job.profileId, job.id);
        this.scheduler.enqueue(job);
      }
    }
    for (const profile of this.profiles.list({ type: 'comfy' })) {
      this.powerManager.scheduleIdleShutdown(profile.id);
    }
    return jobs;
  }

  async shutdownCloudResources() {
    const results = [];
    for (const profile of this.profiles.list({ type: 'comfy' })) {
      if (!this.powerManager.isEnabled?.(profile)) continue;
      try {
        results.push({
          profileId: profile.id,
          ...(await this.powerManager.forcePowerOff(profile.id, { reason: 'application-shutdown' }))
        });
      } catch (error) {
        const failure = redactSecrets({
          profileId: profile.id,
          poweredOff: false,
          reason: 'power-off-failed',
          code: error?.code || 'AUTODL_POWER_OFF_FAILED',
          message: error instanceof Error ? error.message : 'AutoDL 退出关机失败'
        });
        console.error('[Vela Cloud Power] Shutdown power-off failed', safeLogJson(failure));
        results.push(failure);
      }
    }
    return results;
  }

  close() {
    this.powerManager.close?.();
    this.comfyProvider.close?.();
    this.database.close();
  }
}
