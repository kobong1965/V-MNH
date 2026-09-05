import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { MAX_BATCH_SIZE, assertNoPlaintextSecrets } from '../../shared/vela-contracts.js';
import { atomicWriteJson } from './projectStore.js';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'preparing', 'submitting', 'running', 'reconnecting', 'downloading']);
const IMAGE_ASPECT_RATIOS = new Set(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']);
const IMAGE_RESOLUTIONS = new Set(['1K', '2K', '4K']);
const SUPPORTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_BATCH_IMAGE_BYTES = 192 * 1024 * 1024;
const MAX_SYNC_TARGETS = 25;
const MAX_SYNC_OUTPUTS_PER_ITEM = 20;
const MAX_SYNC_ACKNOWLEDGEMENTS = MAX_BATCH_SIZE * MAX_SYNC_OUTPUTS_PER_ITEM;
const SYNC_TARGET_ID = /^[a-z0-9_-]{1,128}$/i;
const SYNC_SOURCE_KEY = /^[a-z0-9][a-z0-9._:@-]{0,511}$/i;
const DEFAULT_SYNC_TARGET = Object.freeze({ id: 'storyworks', name: '编导车间（Storyworks）', kind: 'built-in' });

const ensureDirectory = (directory) => fs.mkdirSync(directory, { recursive: true });

const safeNamePart = (value, fallback = '图片') => {
  const normalized = String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 48);
  return normalized || fallback;
};

const normalizeImageDraft = (image, label, fallbackName) => {
  const data = String(image?.data || '');
  const match = data.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error(`${label}不是有效的图片文件`);
  if (!SUPPORTED_IMAGE_MIMES.has(match[1].toLowerCase())) throw new Error(`${label}图片格式不受支持`);
  const estimatedBytes = Math.floor((match[2].length * 3) / 4);
  if (!estimatedBytes || estimatedBytes > MAX_IMAGE_BYTES) throw new Error(`${label}图片为空或超过 100MB`);
  return {
    name: String(image?.name || fallbackName).slice(0, 255),
    data,
    byteLength: estimatedBytes
  };
};

const normalizeBatchDraft = (draft, profileRepository) => {
  const name = String(draft?.name || '').trim().slice(0, 60);
  const prompt = String(draft?.prompt || '').trim().slice(0, 4000);
  const profileId = String(draft?.profileId || '').trim();
  const aspectRatio = String(draft?.aspectRatio || '1:1');
  const resolution = String(draft?.resolution || '2K');
  const outputCount = Number(draft?.outputCount);
  const images = Array.isArray(draft?.images) ? draft.images : [];
  const benchmarkImage = draft?.benchmarkImage
    ? normalizeImageDraft(draft.benchmarkImage, '对标图', '对标图.png')
    : null;
  const poseVariationEnabled = draft?.poseVariation?.enabled === true;
  const posePrompt = String(draft?.poseVariation?.prompt || '').trim().slice(0, 4000);
  const poseOutputCount = Number(draft?.poseVariation?.outputCount ?? 5);

  if (!name) throw new Error('项目名前缀不能为空');
  if (!prompt) throw new Error('图生图提示词不能为空');
  if (!profileId) throw new Error('请选择 GPT 图片账户');
  if (!IMAGE_ASPECT_RATIOS.has(aspectRatio)) throw new Error(`不支持的画面比例：${aspectRatio}`);
  if (!IMAGE_RESOLUTIONS.has(resolution)) throw new Error(`不支持的图片清晰度：${resolution}`);
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 10) throw new Error('每图张数必须是 1-10');
  if (!images.length || images.length > MAX_BATCH_SIZE) throw new Error(`单批必须上传 1-${MAX_BATCH_SIZE} 张图片`);
  if (poseVariationEnabled && !posePrompt) throw new Error('请填写姿势裂变提示词');
  if (poseVariationEnabled && (!Number.isInteger(poseOutputCount) || poseOutputCount < 2 || poseOutputCount > 10)) {
    throw new Error('姿势裂变张数必须是 2-10');
  }

  const profile = profileRepository.get(profileId);
  if (!profile || profile.type !== 'gpt') throw new Error('所选 GPT 图片账户不存在');
  const imageModel = String(profile.models?.image || '').trim();
  if (!imageModel) throw new Error(`账户“${profile.name}”尚未配置图片模型`);

  const normalizedImages = images.map((image, index) => normalizeImageDraft(image, `第 ${index + 1} 张`, `图片-${index + 1}.png`));
  const totalImageBytes = normalizedImages.reduce((total, image) => total + image.byteLength, 0)
    + (benchmarkImage?.byteLength || 0);
  if (totalImageBytes > MAX_BATCH_IMAGE_BYTES) {
    throw new Error('单批图片总大小不能超过 192MB，请分成多个批次导入');
  }

  return {
    name,
    prompt,
    profileId,
    profileName: profile.name,
    imageModel,
    aspectRatio,
    resolution,
    outputCount,
    images: normalizedImages,
    benchmarkImage,
    poseVariation: {
      enabled: poseVariationEnabled,
      prompt: posePrompt,
      outputCount: poseVariationEnabled ? poseOutputCount : 5
    }
  };
};

const normalizeSyncTargets = ({ target, targets } = {}) => {
  const source = Array.isArray(targets) && targets.length
    ? targets
    : [target === 'storyworks' || !target ? DEFAULT_SYNC_TARGET : { id: target, name: target, kind: 'paired' }];
  if (source.length > MAX_SYNC_TARGETS) throw new Error(`一次最多同步到 ${MAX_SYNC_TARGETS} 个软件`);
  const normalized = source.map((item) => {
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim().slice(0, 80);
    const kind = item?.kind === 'built-in' ? 'built-in' : 'paired';
    if (!SYNC_TARGET_ID.test(id) || !name) throw new Error('同步软件信息无效');
    return { id, name, kind };
  });
  return [...new Map(normalized.map((item) => [item.id, item])).values()];
};

const manifestSourceKeys = (manifest) => [...new Set((Array.isArray(manifest?.items) ? manifest.items : [])
  .flatMap((item) => (Array.isArray(item?.outputs) ? item.outputs : []).map((output) => (
    `${manifest.batchId}:${item.itemId}:${output?.jobId || ''}`
  )))
  .filter((sourceKey) => SYNC_SOURCE_KEY.test(sourceKey)))];

const manifestMediaReferences = (manifest) => (Array.isArray(manifest?.items) ? manifest.items : [])
  .flatMap((item) => Array.isArray(item?.outputs) ? item.outputs : [])
  .map((output) => String(output?.url || ''));

const manifestReferencesProject = (manifest, projectId) => (
  String(manifest?.projectId || '') === projectId
  || (Array.isArray(manifest?.items) && manifest.items.some((item) => String(item?.projectId || '') === projectId))
);

const isManifestAcknowledged = (manifest, acknowledgement) => {
  const sourceKeys = manifestSourceKeys(manifest);
  return acknowledgement?.manifestSyncedAt === manifest.syncedAt
    && (sourceKeys.length ? sourceKeys.every((sourceKey) => acknowledgement.sourceKeys.includes(sourceKey)) : true);
};

const composePrompt = ({ prompt, aspectRatio, resolution, benchmark }) => [
  prompt,
  benchmark ? '参考图顺序：第 1 张是商品原图，第 2 张是对标图。准确提取第 1 张的裤子款式、颜色、面料纹理和设计细节，并应用到第 2 张人物身上。' : '',
  `输出要求：保持单张完整画面，画面比例 ${aspectRatio}，清晰度 ${resolution}。`,
  benchmark
    ? '除裤子外，保持对标图中的人物身份、五官、发型、体型、姿势、上衣、鞋子、配饰、背景、构图、镜头、光线和文字排版不变。'
    : '只修改提示词明确要求的内容，尽量保持原图人物、服装结构、姿势、背景、构图和光线不变。'
].filter(Boolean).join('\n\n');

const composePosePrompt = ({ prompt, aspectRatio, resolution }) => [
  prompt,
  '只允许改变人物姿势。保持人物身份、五官、发型、体型、裤子及其他服装的款式、颜色、面料纹理、鞋子、配饰、背景、构图、镜头、光线、文字和所有其他细节不变。',
  `每张输出必须是单独完整图片，画面比例 ${aspectRatio}，清晰度 ${resolution}。不要生成拼图、分镜、对比图、文字或水印。`
].filter(Boolean).join('\n\n');

const resolveItemStatus = (item, jobs) => {
  if (!item.jobGroupId) return 'draft';
  const groupJobs = jobs.filter((job) => job.groupId === item.jobGroupId);
  if (!groupJobs.length) return 'submitted';
  if (groupJobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return 'running';
  if (groupJobs.some((job) => job.status === 'succeeded')) return 'succeeded';
  if (groupJobs.some((job) => ['failed', 'submission_uncertain'].includes(job.status))) return 'failed';
  if (groupJobs.every((job) => job.status === 'cancelled')) return 'cancelled';
  return 'submitted';
};

const uniqueOutputUrls = (jobs) => [...new Set(jobs
  .filter((job) => job.status === 'succeeded' && job.output?.media?.url)
  .map((job) => job.output.media.url))];

const reconcileGenerationNode = (node, jobs) => {
  if (!jobs.length || jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return node;
  const outputUrls = uniqueOutputUrls(jobs);
  if (outputUrls.length) {
    return {
      ...node,
      status: 'success',
      generationProgress: 100,
      resultUrl: outputUrls.includes(node.resultUrl) ? node.resultUrl : outputUrls[0],
      resultUrls: outputUrls,
      errorMessage: undefined
    };
  }
  if (jobs.every((job) => job.status === 'cancelled')) {
    return {
      ...node,
      status: 'idle',
      generationProgress: 0,
      resultUrl: undefined,
      resultUrls: [],
      errorMessage: undefined
    };
  }
  if (jobs.some((job) => ['failed', 'submission_uncertain', 'succeeded'].includes(job.status))) {
    const failedJob = jobs.find((job) => ['failed', 'submission_uncertain'].includes(job.status));
    return {
      ...node,
      status: 'error',
      generationProgress: 100,
      resultUrl: undefined,
      resultUrls: [],
      errorMessage: String(failedJob?.error?.message || '任务已结束，但没有找到可显示的结果图片。')
    };
  }
  return node;
};

const nodeResultChanged = (current, next) => (
  current.jobGroupId !== next.jobGroupId
  || current.status !== next.status
  || current.generationProgress !== next.generationProgress
  || current.resultUrl !== next.resultUrl
  || JSON.stringify(current.resultUrls || []) !== JSON.stringify(next.resultUrls || [])
  || current.errorMessage !== next.errorMessage
);

const needsSingleProjectMigration = (batch) => {
  const items = Array.isArray(batch?.items) ? batch.items : [];
  if (!items.length) return false;
  const projectIds = new Set(items.map((item) => item.projectId).filter(Boolean));
  return !batch.projectId
    || projectIds.size !== 1
    || !projectIds.has(batch.projectId)
    || items.some((item) => !item.workflowName || !item.groupId);
};

export class BatchWorkflowStore {
  constructor({
    dataDirectory,
    projectStore,
    mediaStore,
    profileRepository,
    createJobGroup,
    listJobs,
    findLatestNodeJob
  }) {
    if (!dataDirectory) throw new Error('dataDirectory is required');
    this.directory = path.join(path.resolve(dataDirectory), 'batch-workflows');
    this.indexPath = path.join(this.directory, 'index.json');
    this.outboxDirectory = path.join(this.directory, 'storyworks-outbox');
    this.inboxAcknowledgementsDirectory = path.join(this.outboxDirectory, 'acknowledgements');
    this.archivedTargetsDirectory = path.join(this.outboxDirectory, 'archived-targets');
    this.targetManifestCache = new Map();
    this.projectStore = projectStore;
    this.mediaStore = mediaStore;
    this.profileRepository = profileRepository;
    this.createJobGroup = createJobGroup;
    this.listJobs = listJobs;
    this.findLatestNodeJob = findLatestNodeJob;
    ensureDirectory(this.directory);
    ensureDirectory(this.outboxDirectory);
    ensureDirectory(this.inboxAcknowledgementsDirectory);
    ensureDirectory(this.archivedTargetsDirectory);
    if (!fs.existsSync(this.indexPath)) atomicWriteJson(this.indexPath, []);
  }

  readIndex() {
    const value = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    if (!Array.isArray(value)) throw new Error('批量工作流索引损坏');
    return value;
  }

  writeIndex(batches) {
    assertNoPlaintextSecrets(batches);
    atomicWriteJson(this.indexPath, batches);
  }

  replaceBatch(batch) {
    const batches = this.readIndex();
    const index = batches.findIndex((candidate) => candidate.id === batch.id);
    if (index === -1) throw new Error('批次不存在');
    batches[index] = batch;
    this.writeIndex(batches);
    return batch;
  }

  migrateLegacyBatch(batch) {
    const legacyProjectIds = [...new Set((batch.items || []).map((item) => item.projectId).filter(Boolean))];
    const prepared = batch.items.map((item, index) => {
      const legacyProject = this.projectStore.getProject(item.projectId);
      if (!legacyProject) throw new Error(`旧批量项目不存在：${item.projectName || item.projectId}`);
      const inputNode = legacyProject.nodes.find((node) => node.id === item.inputNodeId && node.kind === 'image-input');
      const generationNode = legacyProject.nodes.find((node) => node.id === item.generationNodeId && node.kind === 'gpt-image');
      const benchmarkNode = item.benchmarkNodeId
        ? legacyProject.nodes.find((node) => node.id === item.benchmarkNodeId && node.kind === 'image-input')
        : null;
      const poseNode = item.poseNodeId
        ? legacyProject.nodes.find((node) => node.id === item.poseNodeId && node.kind === 'gpt-image')
        : null;
      if (
        !inputNode?.resultUrl
        || !generationNode
        || (item.benchmarkNodeId && !benchmarkNode?.resultUrl)
        || (item.poseNodeId && !poseNode)
      ) throw new Error(`旧工作流不完整：${item.projectName || item.sourceName}`);
      return {
        item,
        index,
        legacyProject,
        inputNode,
        generationNode,
        benchmarkNode,
        poseNode,
        reference: this.mediaStore.readReference(item.projectId, inputNode.resultUrl),
        benchmarkReference: benchmarkNode?.resultUrl
          ? this.mediaStore.readReference(item.projectId, benchmarkNode.resultUrl)
          : null
      };
    });

    const projectId = `batch-${batch.id}`;
    const projectName = String(batch.name || batch.projectName || '批量项目').trim() || '批量项目';
    const placeholder = this.projectStore.saveProject({
      id: projectId,
      name: projectName,
      createdAt: batch.createdAt,
      nodes: [],
      groups: [],
      viewport: { x: 40, y: 40, zoom: 0.55 },
      settings: {
        batchWorkflow: {
          batchId: batch.id,
          itemIds: [],
          workflowCount: prepared.length,
          syncTarget: 'storyworks',
          legacyProjectIds
        }
      }
    });
    const nodes = [];
    const groups = [];
    const items = prepared.map(({
      item,
      index,
      inputNode,
      generationNode,
      benchmarkNode,
      poseNode,
      reference
    }) => {
      const workflowName = `工作流 ${String(index + 1).padStart(2, '0')} · ${safeNamePart(item.sourceName, `图片-${index + 1}`)}`.slice(0, 120);
      const groupId = `batch-group-${item.id}`;
      const inputNodeId = `batch-input-${item.id}`;
      const benchmarkNodeId = benchmarkNode ? `batch-benchmark-${item.id}` : null;
      const generationNodeId = `batch-output-${item.id}`;
      const poseNodeId = poseNode ? `batch-pose-${item.id}` : null;
      const baseY = 160 + index * (benchmarkNode ? 1120 : 820);
      const media = this.mediaStore.saveCopiedMedia(placeholder.id, {
        data: reference.data,
        mime: reference.mime,
        fileName: item.sourceName || reference.filename,
        source: {
          type: 'batch-migration',
          legacyProjectId: item.projectId,
          legacyNodeId: item.inputNodeId
        }
      });
      const benchmarkMedia = benchmarkNode?.resultUrl
        ? this.mediaStore.saveCopiedMedia(placeholder.id, {
          ...this.mediaStore.readReference(item.projectId, benchmarkNode.resultUrl),
          fileName: batch.benchmark?.name || '对标图',
          source: {
            type: 'batch-migration',
            legacyProjectId: item.projectId,
            legacyNodeId: item.benchmarkNodeId
          }
        })
        : null;
      const remapResultUrls = (node, role) => {
        const oldUrls = [...new Set([node?.resultUrl, ...(node?.resultUrls || [])].filter(Boolean))];
        const urlMap = new Map(oldUrls.map((url, outputIndex) => {
          const copied = this.mediaStore.saveCopiedMedia(placeholder.id, {
            ...this.mediaStore.readReference(item.projectId, url),
            fileName: `${safeNamePart(item.sourceName)}-${role}-${outputIndex + 1}`,
            source: {
              type: 'batch-migration-output',
              legacyProjectId: item.projectId,
              legacyNodeId: node.id
            }
          });
          return [url, copied.url];
        }));
        return {
          resultUrl: node?.resultUrl ? urlMap.get(node.resultUrl) : undefined,
          resultUrls: (node?.resultUrls || []).map((url) => urlMap.get(url)).filter(Boolean),
          copiedUrls: [...urlMap.values()]
        };
      };
      const generationResults = remapResultUrls(generationNode, '主图');
      const poseResults = poseNode ? remapResultUrls(poseNode, '姿势') : { copiedUrls: [] };
      nodes.push({
        ...inputNode,
        id: inputNodeId,
        x: 120,
        y: baseY,
        resultUrl: media.url,
        parentIds: [],
        groupId
      }, ...(benchmarkNode ? [{
        ...benchmarkNode,
        id: benchmarkNodeId,
        x: 120,
        y: baseY + 470,
        resultUrl: benchmarkMedia.url,
        parentIds: [],
        groupId
      }] : []), {
        ...generationNode,
        id: generationNodeId,
        x: 780,
        y: baseY + (benchmarkNode ? 210 : 0),
        parentIds: [inputNodeId, ...(benchmarkNodeId ? [benchmarkNodeId] : [])],
        groupId,
        resultUrl: generationResults.resultUrl,
        resultUrls: generationResults.resultUrls
      }, ...(poseNode ? [{
        ...poseNode,
        id: poseNodeId,
        x: 1440,
        y: baseY + (benchmarkNode ? 210 : 0),
        parentIds: [generationNodeId],
        groupId,
        resultUrl: poseResults.resultUrl,
        resultUrls: poseResults.resultUrls
      }] : []));
      groups.push({
        id: groupId,
        nodeIds: [inputNodeId, ...(benchmarkNodeId ? [benchmarkNodeId] : []), generationNodeId, ...(poseNodeId ? [poseNodeId] : [])],
        label: workflowName
      });
      const migratedOutputs = [...generationResults.copiedUrls, ...poseResults.copiedUrls]
        .slice(0, MAX_SYNC_OUTPUTS_PER_ITEM)
        .map((url) => ({
          jobId: `legacy-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}`,
          url
        }));
      return {
        ...item,
        projectId: placeholder.id,
        projectName,
        workflowName,
        groupId,
        inputNodeId,
        benchmarkNodeId,
        generationNodeId,
        poseNodeId,
        sourceUrl: media.url,
        benchmarkUrl: benchmarkMedia?.url || null,
        migratedOutputs,
        legacyJobGroupId: item.jobGroupId || null,
        jobGroupId: null,
        legacyProjectId: item.projectId
      };
    });

    this.projectStore.saveProject({
      ...placeholder,
      nodes,
      groups,
      settings: {
        ...placeholder.settings,
        batchWorkflow: {
          ...placeholder.settings.batchWorkflow,
          itemIds: items.map((item) => item.id)
        }
      }
    });
    return {
      ...batch,
      projectId: placeholder.id,
      projectName,
      items,
      legacyProjectIds,
      migratedToSingleProjectAt: new Date().toISOString()
    };
  }

  migrateLegacyBatches() {
    const batches = this.readIndex();
    let changed = false;
    const migrated = batches.map((batch) => {
      if (!needsSingleProjectMigration(batch)) return batch;
      try {
        const next = this.migrateLegacyBatch(batch);
        changed = true;
        return next;
      } catch {
        return batch;
      }
    });
    if (changed) this.writeIndex(migrated);
    return migrated;
  }

  decorate(batch, jobsByGroup) {
    const resolvedJobsByGroup = jobsByGroup || this.createJobsByGroup();
    const exactGroupIds = new Set();
    const items = batch.items.map((item) => {
      const mainLatest = this.findLatestNodeJob?.(item.projectId, item.generationNodeId);
      const poseLatest = item.poseNodeId
        ? this.findLatestNodeJob?.(item.projectId, item.poseNodeId)
        : null;
      const mainGroupId = mainLatest?.groupId || item.jobGroupId || null;
      const poseGroupId = poseLatest?.groupId || null;
      const jobsForGroup = (groupId) => {
        if (!groupId) return [];
        if (!exactGroupIds.has(groupId)) {
          resolvedJobsByGroup.set(groupId, this.listJobs?.({
            groupId,
            limit: MAX_SYNC_OUTPUTS_PER_ITEM,
            newestFirst: false
          }) || []);
          exactGroupIds.add(groupId);
        }
        return resolvedJobsByGroup.get(groupId) || [];
      };
      const mainJobs = jobsForGroup(mainGroupId);
      const poseJobs = poseGroupId && poseGroupId !== mainGroupId ? jobsForGroup(poseGroupId) : [];
      const groupJobs = [...mainJobs, ...poseJobs];
      const generatedOutputs = groupJobs
        .filter((job) => job.status === 'succeeded' && job.output?.media?.url)
        .map((job) => ({ jobId: job.id, url: job.output.media.url }));
      const outputs = [...new Map([
        ...generatedOutputs,
        ...(Array.isArray(item.migratedOutputs) ? item.migratedOutputs : [])
      ].map((output) => [output.jobId, output])).values()].slice(0, MAX_SYNC_OUTPUTS_PER_ITEM);
      let status = resolveItemStatus({ ...item, jobGroupId: mainGroupId }, mainJobs);
      if (groupJobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) status = 'running';
      else if (status === 'draft' && outputs.length) status = 'succeeded';
      return {
        ...item,
        status,
        progress: groupJobs.length
          ? Math.round(groupJobs.reduce((total, job) => total + (Number(job.progress) || 0), 0) / groupJobs.length * 100)
          : 0,
        outputs
      };
    });
    return { ...batch, items };
  }

  createJobsByGroup() {
    const jobsByGroup = new Map();
    for (const job of this.listJobs?.() || []) {
      const groupJobs = jobsByGroup.get(job.groupId) || [];
      groupJobs.push(job);
      jobsByGroup.set(job.groupId, groupJobs);
    }
    return jobsByGroup;
  }

  getBatchProjectIds(batches = this.readIndex()) {
    return new Set(batches.flatMap((batch) => [
      batch.projectId,
      ...(Array.isArray(batch.items) ? batch.items.map((item) => item.projectId) : [])
    ]).filter(Boolean));
  }

  decorateProjectSummaries(projects) {
    let batches;
    try {
      batches = this.migrateLegacyBatches();
    } catch {
      return projects.map((project) => ({ ...project, category: 'project' }));
    }
    const batchProjectIds = this.getBatchProjectIds(batches);
    const legacyProjectIds = new Set(batches.flatMap((batch) => batch.legacyProjectIds || []));
    return this.projectStore.listProjects()
      .filter((project) => !legacyProjectIds.has(project.id))
      .map((project) => ({
      ...project,
      category: batchProjectIds.has(project.id) ? 'batch' : 'project'
      }));
  }

  reconcileResults(batches, jobsByGroup, onlyProjectId = null) {
    const nodesByProject = new Map();
    for (const batch of batches) {
      for (const item of batch.items || []) {
        if (!item.projectId || !item.generationNodeId) continue;
        if (onlyProjectId && item.projectId !== onlyProjectId) continue;
        const entries = nodesByProject.get(item.projectId) || [];
        entries.push({ nodeId: item.generationNodeId, fallbackGroupId: item.jobGroupId || null });
        if (item.poseNodeId) entries.push({ nodeId: item.poseNodeId, fallbackGroupId: null });
        nodesByProject.set(item.projectId, entries);
      }
    }

    const reconciled = new Map();
    for (const [projectId, entries] of nodesByProject) {
      const project = this.projectStore.getProject(projectId);
      if (!project) continue;
      const entryByNodeId = new Map(entries.map((entry) => [entry.nodeId, entry]));
      const exactJobsByGroup = new Map();
      let changed = false;
      const nodes = project.nodes.map((node) => {
        const entry = entryByNodeId.get(node.id);
        if (!entry) return node;
        const latest = this.findLatestNodeJob?.(projectId, node.id);
        const groupId = latest?.groupId || node.jobGroupId || entry.fallbackGroupId;
        if (!groupId) return node;
        if (!exactJobsByGroup.has(groupId)) {
          exactJobsByGroup.set(groupId, this.listJobs?.({
            groupId,
            limit: MAX_SYNC_OUTPUTS_PER_ITEM,
            newestFirst: false
          }) || jobsByGroup.get(groupId) || []);
        }
        const next = reconcileGenerationNode({ ...node, jobGroupId: groupId }, exactJobsByGroup.get(groupId));
        if (nodeResultChanged(node, next)) changed = true;
        return next;
      });
      reconciled.set(projectId, changed ? this.projectStore.saveProject({ ...project, nodes }) : project);
    }
    return reconciled;
  }

  reconcileProject(projectId) {
    let batches;
    try {
      batches = this.readIndex();
    } catch {
      return null;
    }
    if (!this.getBatchProjectIds(batches).has(projectId)) return null;
    return this.reconcileResults(batches, this.createJobsByGroup(), projectId).get(projectId)
      || this.projectStore.getProject(projectId);
  }

  listBatches() {
    const jobsByGroup = this.createJobsByGroup();
    const batches = this.migrateLegacyBatches().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.reconcileResults(batches, jobsByGroup);
    return batches
      .map((batch) => this.decorate(batch, jobsByGroup));
  }

  getBatch(batchId) {
    const batch = this.migrateLegacyBatches().find((candidate) => candidate.id === batchId);
    if (!batch) return null;
    const jobsByGroup = this.createJobsByGroup();
    this.reconcileResults([batch], jobsByGroup);
    return this.decorate(batch, jobsByGroup);
  }

  createBatch(draft) {
    const input = normalizeBatchDraft(draft, this.profileRepository);
    const batchId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const projectName = input.name;
    const placeholder = this.projectStore.saveProject({
      name: projectName,
      nodes: [],
      groups: [],
      viewport: { x: 40, y: 40, zoom: input.poseVariation.enabled ? 0.42 : 0.55 },
      settings: {
        batchWorkflow: {
          batchId,
          itemIds: [],
          workflowCount: input.images.length,
          syncTarget: 'storyworks',
          benchmarkEnabled: Boolean(input.benchmarkImage),
          poseVariationEnabled: input.poseVariation.enabled
        }
      }
    });
    const benchmarkMedia = input.benchmarkImage
      ? this.mediaStore.saveUploadedMedia(placeholder.id, {
        dataUrl: input.benchmarkImage.data,
        fileName: input.benchmarkImage.name
      })
      : null;
    const nodes = [];
    const groups = [];
    const items = input.images.map((image, index) => {
      const itemId = crypto.randomUUID();
      const sourceName = safeNamePart(image.name, `图片-${index + 1}`);
      const workflowName = `工作流 ${String(index + 1).padStart(2, '0')} · ${sourceName}`.slice(0, 120);
      const groupId = crypto.randomUUID();
      const media = this.mediaStore.saveUploadedMedia(placeholder.id, {
        dataUrl: image.data,
        fileName: image.name
      });
      const baseY = 160 + index * (input.benchmarkImage ? 1120 : 860);
      const inputNodeId = crypto.randomUUID();
      const benchmarkNodeId = benchmarkMedia ? crypto.randomUUID() : null;
      const generationNodeId = crypto.randomUUID();
      const poseNodeId = input.poseVariation.enabled ? crypto.randomUUID() : null;
      const inputNode = {
        id: inputNodeId,
        type: 'Image',
        kind: 'image-input',
        title: `商品原图 · ${image.name}`,
        x: 120,
        y: baseY,
        prompt: image.name,
        status: 'success',
        resultUrl: media.url,
        model: 'Upload',
        aspectRatio: input.aspectRatio,
        resolution: 'Auto',
        outputCount: 1,
        parentIds: [],
        groupId,
        annotationText: '商品原图',
        annotationColor: '#d43b2f',
        annotationFontSize: 22
      };
      const benchmarkNode = benchmarkMedia ? {
        id: benchmarkNodeId,
        type: 'Image',
        kind: 'image-input',
        title: `对标图 · ${input.benchmarkImage.name}`,
        x: 120,
        y: baseY + 470,
        prompt: '全批次共享对标图',
        status: 'success',
        resultUrl: benchmarkMedia.url,
        model: 'Upload',
        aspectRatio: input.aspectRatio,
        resolution: 'Auto',
        outputCount: 1,
        parentIds: [],
        groupId,
        annotationText: '对标图',
        annotationColor: '#d43b2f',
        annotationFontSize: 22
      } : null;
      const generationNode = {
        id: generationNodeId,
        type: 'Image',
        kind: 'gpt-image',
        title: benchmarkMedia ? `换装主图 · ${input.name}` : `图生图 · ${input.name}`,
        x: 780,
        y: baseY + (benchmarkMedia ? 210 : 0),
        prompt: input.prompt,
        status: 'idle',
        profileId: input.profileId,
        model: input.imageModel,
        imageModel: input.imageModel,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        outputCount: input.outputCount,
        imageBatchMode: 'independent',
        parentIds: [inputNodeId, ...(benchmarkNodeId ? [benchmarkNodeId] : [])],
        groupId,
        annotationText: input.poseVariation.enabled ? '主图 · 满意后再裂变' : undefined,
        annotationColor: '#0b8598',
        annotationFontSize: 20
      };
      const poseNode = poseNodeId ? {
        id: poseNodeId,
        type: 'Image',
        kind: 'gpt-image',
        title: '后缀 · 姿势裂变',
        x: 1440,
        y: generationNode.y,
        prompt: composePosePrompt({
          prompt: input.poseVariation.prompt,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution
        }),
        status: 'idle',
        profileId: input.profileId,
        model: input.imageModel,
        imageModel: input.imageModel,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        outputCount: input.poseVariation.outputCount,
        imageBatchMode: 'pose-variation',
        requiresGeneratedReference: true,
        parentIds: [generationNodeId],
        groupId,
        annotationText: '后缀 · 只换姿势',
        annotationColor: '#0b8598',
        annotationFontSize: 20
      } : null;
      nodes.push(inputNode, ...(benchmarkNode ? [benchmarkNode] : []), generationNode, ...(poseNode ? [poseNode] : []));
      groups.push({
        id: groupId,
        nodeIds: [inputNodeId, ...(benchmarkNodeId ? [benchmarkNodeId] : []), generationNodeId, ...(poseNodeId ? [poseNodeId] : [])],
        label: workflowName
      });
      return {
        id: itemId,
        index,
        sourceName: image.name,
        projectId: placeholder.id,
        projectName,
        workflowName,
        groupId,
        inputNodeId,
        benchmarkNodeId,
        generationNodeId,
        poseNodeId,
        sourceUrl: media.url,
        benchmarkUrl: benchmarkMedia?.url || null,
        jobGroupId: null
      };
    });

    this.projectStore.saveProject({
      ...placeholder,
      nodes,
      groups,
      settings: {
        ...placeholder.settings,
        batchWorkflow: {
          batchId,
          itemIds: items.map((item) => item.id),
          workflowCount: items.length,
          syncTarget: 'storyworks',
          benchmarkEnabled: Boolean(benchmarkMedia),
          poseVariationEnabled: input.poseVariation.enabled
        }
      }
    });

    const batch = {
      id: batchId,
      name: input.name,
      projectId: placeholder.id,
      projectName,
      prompt: input.prompt,
      profileId: input.profileId,
      profileName: input.profileName,
      imageModel: input.imageModel,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      outputCount: input.outputCount,
      benchmark: benchmarkMedia ? { name: input.benchmarkImage.name, url: benchmarkMedia.url } : null,
      poseVariation: input.poseVariation,
      createdAt,
      updatedAt: createdAt,
      sync: null,
      items
    };
    this.writeIndex([batch, ...this.readIndex()]);
    return this.decorate(batch);
  }

  startBatch(batchId, { itemIds } = {}) {
    const batch = this.migrateLegacyBatches().find((candidate) => candidate.id === batchId);
    if (!batch) throw new Error('批次不存在');
    const selectedIds = new Set(Array.isArray(itemIds) && itemIds.length ? itemIds : batch.items.map((item) => item.id));
    let started = 0;
    let skipped = 0;
    const errors = [];

    for (const item of batch.items) {
      if (!selectedIds.has(item.id)) continue;
      if (item.jobGroupId) {
        skipped += 1;
        continue;
      }
      try {
        const project = this.projectStore.getProject(item.projectId);
        if (!project) throw new Error('项目不存在');
        const generationNode = project.nodes.find((node) => node.id === item.generationNodeId && node.kind === 'gpt-image');
        const inputNode = project.nodes.find((node) => node.id === item.inputNodeId && node.kind === 'image-input');
        const benchmarkNode = item.benchmarkNodeId
          ? project.nodes.find((node) => node.id === item.benchmarkNodeId && node.kind === 'image-input')
          : null;
        if (!generationNode || !inputNode?.resultUrl || (item.benchmarkNodeId && !benchmarkNode?.resultUrl)) {
          throw new Error('图生图工作流不完整');
        }

        const existingJob = this.findLatestNodeJob?.(project.id, generationNode.id);
        if (existingJob?.groupId) {
          item.jobGroupId = existingJob.groupId;
          batch.updatedAt = new Date().toISOString();
          this.replaceBatch(batch);
          skipped += 1;
          continue;
        }

        const created = this.createJobGroup({
          projectId: project.id,
          nodeId: generationNode.id,
          profileId: batch.profileId,
          providerType: 'gpt',
          payload: {
            prompt: composePrompt(batch),
            nodeKind: 'gpt-image',
            referenceUrls: [inputNode.resultUrl, ...(benchmarkNode?.resultUrl ? [benchmarkNode.resultUrl] : [])],
            aspectRatio: batch.aspectRatio,
            resolution: batch.resolution,
            imageBatchMode: 'independent'
          },
          count: batch.outputCount,
          seedMode: 'increment',
          seed: (Date.now() + item.index) % 2147483647
        });
        item.jobGroupId = created.group.id;
        batch.updatedAt = new Date().toISOString();
        this.replaceBatch(batch);
        this.projectStore.saveProject({
          ...project,
          nodes: project.nodes.map((node) => node.id === generationNode.id ? {
            ...node,
            jobGroupId: created.group.id,
            status: 'loading',
            generationProgress: 0,
            errorMessage: undefined
          } : node)
        });
        started += 1;
      } catch (error) {
        errors.push({ itemId: item.id, message: error instanceof Error ? error.message : '任务提交失败' });
      }
    }

    return { batch: this.decorate(batch), started, skipped, errors };
  }

  syncBatch(batchId, options = {}) {
    const targets = normalizeSyncTargets(options);
    const batch = this.getBatch(batchId);
    if (!batch) throw new Error('批次不存在');
    const unfinished = batch.items.filter((item) => ['draft', 'submitted', 'running'].includes(item.status));
    if (unfinished.length) {
      throw new Error(`仍有 ${unfinished.length} 个工作流未完成，请等待生成结束后再同步`);
    }
    const outputTotal = batch.items.reduce((total, item) => total + item.outputs.length, 0);
    if (!outputTotal) throw new Error('当前批次还没有可同步的成功图片');
    const syncedAt = new Date().toISOString();
    const manifestBase = {
      format: 'vela-storyworks-batch',
      version: 1,
      batchId: batch.id,
      batchName: batch.name,
      projectId: batch.projectId || batch.items[0]?.projectId || null,
      projectName: batch.projectName || batch.name,
      syncedAt,
      prompt: batch.prompt,
      settings: {
        profileName: batch.profileName,
        imageModel: batch.imageModel,
        aspectRatio: batch.aspectRatio,
        resolution: batch.resolution,
        outputCount: batch.outputCount,
        benchmark: batch.benchmark || null,
        poseVariation: {
          enabled: batch.poseVariation?.enabled === true,
          prompt: String(batch.poseVariation?.prompt || '').slice(0, 4000),
          outputCount: Number.isInteger(batch.poseVariation?.outputCount)
            && batch.poseVariation.outputCount >= 1
            && batch.poseVariation.outputCount <= 10
            ? batch.poseVariation.outputCount
            : 5
        }
      },
      items: batch.items.map((item) => ({
        itemId: item.id,
        sourceName: item.sourceName,
        projectId: item.projectId,
        projectName: item.projectName,
        workflowName: item.workflowName || item.projectName,
        groupId: item.groupId || null,
        nodeId: item.generationNodeId,
        benchmarkNodeId: item.benchmarkNodeId || null,
        poseNodeId: item.poseNodeId || null,
        status: item.status,
        outputs: item.outputs
      }))
    };
    const results = targets.map((syncTarget) => {
      const manifest = { ...manifestBase, target: syncTarget.id, targetApp: syncTarget };
      assertNoPlaintextSecrets(manifest);
      const manifestPath = syncTarget.id === 'storyworks'
        ? path.join(this.outboxDirectory, `${batch.id}.json`)
        : path.join(this.outboxDirectory, 'targets', syncTarget.id, `${batch.id}.json`);
      try {
        atomicWriteJson(manifestPath, manifest);
        if (syncTarget.id !== 'storyworks') this.invalidateTargetManifestCache(syncTarget.id);
        return {
          ...syncTarget,
          status: 'succeeded',
          syncedAt,
          manifestPath,
          manifestUrl: `/api/vela/batches/${batch.id}/sync-manifest${syncTarget.id === 'storyworks' ? '' : `?targetId=${encodeURIComponent(syncTarget.id)}`}`
        };
      } catch (error) {
        return { ...syncTarget, status: 'failed', syncedAt, error: error instanceof Error ? error.message : '同步清单写入失败' };
      }
    });
    const succeeded = results.filter((result) => result.status === 'succeeded');
    if (!succeeded.length) throw new Error(results[0]?.error || '所有软件同步均失败');

    const rawBatch = this.readIndex().find((candidate) => candidate.id === batch.id);
    if (succeeded.some((result) => result.id === 'storyworks')) rawBatch.sync = { target: 'storyworks', syncedAt };
    rawBatch.lastSync = {
      syncedAt,
      targets: results.map(({ id, name, kind, status, error }) => ({ id, name, kind, status, ...(error ? { error } : {}) }))
    };
    rawBatch.updatedAt = syncedAt;
    this.replaceBatch(rawBatch);
    const primary = succeeded[0];
    return {
      ...manifestBase,
      target: primary.id,
      targets: results.map(({ manifestPath: _manifestPath, ...result }) => result),
      manifestPath: primary.manifestPath,
      manifestUrl: primary.manifestUrl
    };
  }

  invalidateTargetManifestCache(targetId) {
    this.targetManifestCache.delete(targetId);
  }

  activeTargetManifestPath(targetId, batchId) {
    return path.join(this.outboxDirectory, 'targets', targetId, `${batchId}.json`);
  }

  archivedTargetManifestPath(targetId, batchId) {
    return path.join(this.archivedTargetsDirectory, targetId, `${batchId}.json`);
  }

  readTargetManifestDirectory(directory, targetId) {
    if (!fs.existsSync(directory)) return new Map();
    return new Map(fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .flatMap((entry) => {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
          if (
            manifest?.target !== targetId
            || !SYNC_TARGET_ID.test(String(manifest?.batchId || ''))
            || typeof manifest?.syncedAt !== 'string'
          ) return [];
          return [[manifest.batchId, manifest]];
        } catch {
          return [];
        }
      }));
  }

  readTargetManifestState(targetId) {
    if (!SYNC_TARGET_ID.test(targetId) || targetId === 'storyworks') throw new Error('同步软件 ID 无效');
    const cached = this.targetManifestCache.get(targetId);
    if (cached) return cached;
    const active = this.readTargetManifestDirectory(path.join(this.outboxDirectory, 'targets', targetId), targetId);
    const archived = this.readTargetManifestDirectory(path.join(this.archivedTargetsDirectory, targetId), targetId);
    const mediaReferences = new Set([...active.values(), ...archived.values()].flatMap(manifestMediaReferences));
    const state = { active, archived, mediaReferences };
    this.targetManifestCache.set(targetId, state);
    return state;
  }

  getSyncManifest(batchId, targetId = 'storyworks') {
    const batch = this.readIndex().find((candidate) => candidate.id === batchId);
    if (!batch) return null;
    if (!SYNC_TARGET_ID.test(targetId)) throw new Error('同步软件 ID 无效');
    if (targetId === 'storyworks') {
      const manifestPath = path.join(this.outboxDirectory, `${batchId}.json`);
      return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    }
    const state = this.readTargetManifestState(targetId);
    return state.active.get(batchId) || state.archived.get(batchId) || null;
  }

  readInboxAcknowledgements(targetId) {
    if (!SYNC_TARGET_ID.test(targetId)) throw new Error('同步软件 ID 无效');
    const acknowledgementPath = path.join(this.inboxAcknowledgementsDirectory, `${targetId}.json`);
    if (!fs.existsSync(acknowledgementPath)) return { version: 1, targetId, batches: [] };
    try {
      const stored = JSON.parse(fs.readFileSync(acknowledgementPath, 'utf8'));
      if (stored?.version !== 1 || stored?.targetId !== targetId || !Array.isArray(stored.batches)) throw new Error();
      return {
        version: 1,
        targetId,
        batches: stored.batches.filter((entry) => (
          entry
          && SYNC_TARGET_ID.test(String(entry.batchId || ''))
          && typeof entry.manifestSyncedAt === 'string'
          && Array.isArray(entry.sourceKeys)
          && entry.sourceKeys.every((sourceKey) => SYNC_SOURCE_KEY.test(String(sourceKey)))
        )).map((entry) => ({
          batchId: String(entry.batchId),
          manifestSyncedAt: entry.manifestSyncedAt,
          sourceKeys: [...new Set(entry.sourceKeys.map(String))]
        }))
      };
    } catch {
      throw new Error('同步收件箱确认记录损坏');
    }
  }

  listSyncInbox(targetId, { cursor = '0', limit = 500 } = {}) {
    if (!SYNC_TARGET_ID.test(targetId) || targetId === 'storyworks') throw new Error('同步软件 ID 无效');
    if (!/^\d{1,8}$/.test(String(cursor))) throw new Error('同步收件箱游标无效');
    const offset = Number(cursor);
    const pageSize = Math.max(1, Math.min(500, Number(limit) || 500));
    const acknowledgements = new Map(this.readInboxAcknowledgements(targetId).batches.map((entry) => [entry.batchId, entry]));
    const pending = [...this.readTargetManifestState(targetId).active.values()]
      .flatMap((manifest) => {
        const acknowledged = acknowledgements.get(manifest.batchId);
        return isManifestAcknowledged(manifest, acknowledged)
          ? []
          : [{ batchId: manifest.batchId, syncedAt: manifest.syncedAt }];
      })
      .sort((left, right) => left.syncedAt.localeCompare(right.syncedAt));
    const items = pending.slice(offset, offset + pageSize);
    const nextOffset = offset + items.length;
    return {
      version: 1,
      items,
      ...(nextOffset < pending.length ? { nextCursor: String(nextOffset) } : {})
    };
  }

  acknowledgeSyncInbox(targetId, batchId, sourceKeys = []) {
    if (!SYNC_TARGET_ID.test(targetId) || targetId === 'storyworks') throw new Error('同步软件 ID 无效');
    if (!SYNC_TARGET_ID.test(batchId)) throw new Error('同步批次 ID 无效');
    if (!Array.isArray(sourceKeys) || sourceKeys.length > MAX_SYNC_ACKNOWLEDGEMENTS) throw new Error('同步来源确认数量无效');
    const normalizedSourceKeys = [...new Set(sourceKeys.map((sourceKey) => String(sourceKey || '').trim()))];
    if (normalizedSourceKeys.some((sourceKey) => !SYNC_SOURCE_KEY.test(sourceKey))) throw new Error('同步来源标识无效');
    const manifest = this.readTargetManifestState(targetId).active.get(batchId);
    if (!manifest) {
      const error = new Error('该批次尚未同步到当前软件');
      error.status = 404;
      throw error;
    }
    const allowedSourceKeys = new Set(manifestSourceKeys(manifest));
    const unknownSourceKey = normalizedSourceKeys.find((sourceKey) => !allowedSourceKeys.has(sourceKey));
    if (unknownSourceKey) throw new Error('同步来源不属于当前软件的批次清单');

    const acknowledgements = this.readInboxAcknowledgements(targetId);
    const existing = acknowledgements.batches.find((entry) => entry.batchId === batchId);
    const updated = {
      batchId,
      manifestSyncedAt: manifest.syncedAt,
      sourceKeys: [...new Set([
        ...(existing?.manifestSyncedAt === manifest.syncedAt ? existing.sourceKeys : []),
        ...normalizedSourceKeys
      ])]
        .filter((sourceKey) => allowedSourceKeys.has(sourceKey))
    };
    const next = {
      version: 1,
      targetId,
      updatedAt: new Date().toISOString(),
      batches: [...acknowledgements.batches.filter((entry) => entry.batchId !== batchId), updated]
    };
    assertNoPlaintextSecrets(next);
    atomicWriteJson(path.join(this.inboxAcknowledgementsDirectory, `${targetId}.json`), next);
    const complete = updated.manifestSyncedAt === manifest.syncedAt
      && [...allowedSourceKeys].every((sourceKey) => updated.sourceKeys.includes(sourceKey));
    if (complete) {
      const activePath = this.activeTargetManifestPath(targetId, batchId);
      const archivedPath = this.archivedTargetManifestPath(targetId, batchId);
      ensureDirectory(path.dirname(archivedPath));
      try {
        fs.renameSync(activePath, archivedPath);
      } catch {
        fs.copyFileSync(activePath, archivedPath);
        fs.unlinkSync(activePath);
      }
    }
    this.invalidateTargetManifestCache(targetId);
    return { version: 1, batchId, acknowledged: updated.sourceKeys.length };
  }

  isMediaReferencedForTarget(targetId, projectId, mediaId) {
    if (!SYNC_TARGET_ID.test(targetId) || targetId === 'storyworks') return false;
    const expectedUrl = `/api/vela/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/file`;
    return this.readTargetManifestState(targetId).mediaReferences.has(expectedUrl);
  }

  cancelSyncTargets(targetIds, reason = 'connection-revoked') {
    const normalizedTargets = [...new Set((Array.isArray(targetIds) ? targetIds : [])
      .map((targetId) => String(targetId || '').trim())
      .filter((targetId) => targetId !== 'storyworks' && SYNC_TARGET_ID.test(targetId)))];
    let cancelled = 0;
    const cancelledAt = new Date().toISOString();
    for (const targetId of normalizedTargets) {
      const state = this.readTargetManifestState(targetId);
      for (const [batchId, manifest] of state.active) {
        const activePath = this.activeTargetManifestPath(targetId, batchId);
        const archivedPath = this.archivedTargetManifestPath(targetId, batchId);
        ensureDirectory(path.dirname(archivedPath));
        atomicWriteJson(archivedPath, {
          ...manifest,
          cancelledAt,
          cancellationReason: String(reason || 'connection-revoked').slice(0, 80)
        });
        if (fs.existsSync(activePath)) fs.unlinkSync(activePath);
        cancelled += 1;
      }
      this.invalidateTargetManifestCache(targetId);
    }
    return { cancelled, targetCount: normalizedTargets.length };
  }

  cancelOrphanedSyncTargets(activeTargetIds) {
    const activeTargets = new Set((Array.isArray(activeTargetIds) ? activeTargetIds : [])
      .map((targetId) => String(targetId || '').trim())
      .filter((targetId) => SYNC_TARGET_ID.test(targetId)));
    const targetsDirectory = path.join(this.outboxDirectory, 'targets');
    if (!fs.existsSync(targetsDirectory)) return { cancelled: 0, targetCount: 0 };
    const orphanedTargets = fs.readdirSync(targetsDirectory, { withFileTypes: true })
      .filter((entry) => (
        entry.isDirectory()
        && entry.name !== 'storyworks'
        && SYNC_TARGET_ID.test(entry.name)
        && !activeTargets.has(entry.name)
      ))
      .map((entry) => entry.name);
    return this.cancelSyncTargets(orphanedTargets, 'orphaned-connection');
  }

  hasPendingSyncForProject(projectId) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) return false;
    const targetsDirectory = path.join(this.outboxDirectory, 'targets');
    if (!fs.existsSync(targetsDirectory)) return false;

    const targets = fs.readdirSync(targetsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'storyworks' && SYNC_TARGET_ID.test(entry.name));
    for (const target of targets) {
      const acknowledgements = new Map(this.readInboxAcknowledgements(target.name).batches
        .map((entry) => [entry.batchId, entry]));
      for (const manifest of this.readTargetManifestState(target.name).active.values()) {
        if (
          manifestReferencesProject(manifest, normalizedProjectId)
          && !isManifestAcknowledged(manifest, acknowledgements.get(manifest.batchId))
        ) return true;
      }
    }
    return false;
  }
}
