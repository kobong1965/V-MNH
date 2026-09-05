import express from 'express';
import fs from 'node:fs';

import {
  ContractValidationError,
  VELA_CONTROL_CAPABILITIES,
  VELA_CONTROL_PROTOCOL_VERSION
} from '../../shared/vela-contracts.js';
import { ProviderError } from '../providers/openAiCompatibleProvider.js';
import { ComfyUiError } from '../providers/comfyUiProvider.js';
import { AutoDlPowerError } from '../providers/autodlPowerProvider.js';
import { redactSecrets } from '../vela/redaction.js';
import { isMaterialsReadOnlyClient } from '../vela/pairingService.js';

const router = express.Router();

const runtime = (req) => {
  if (!req.app.locals.velaRuntime) throw new Error('Vela runtime is not configured');
  return req.app.locals.velaRuntime;
};

const handleError = (res, error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const providerError = error instanceof ProviderError || error instanceof ComfyUiError || error instanceof AutoDlPowerError;
  const explicitStatus = Number(error?.status);
  const status = !providerError && Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
    ? explicitStatus
    : providerError
    ? error.code === 'AUTH_FAILED' ? 401
      : error.code === 'INVALID_INPUT' ? 400
      : ['MODEL_NOT_FOUND', 'CREDENTIAL_UNREADABLE', 'CREDENTIAL_MISSING'].includes(error.code) ? 422
        : 502
    : error instanceof ContractValidationError || /invalid|unsupported|required|cannot|不能为空|not found|不支持|无效|上传内容/i.test(message) ? 400 : 500;
  res.status(status).json(redactSecrets({
    error: message,
    ...(!providerError && typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(!providerError && typeof error?.expectedFingerprint === 'string'
      ? { details: { expectedFingerprint: error.expectedFingerprint } }
      : {}),
    ...(providerError ? {
      code: error.code,
      retryable: error.retryable,
      safeToRetry: error.safeToRetry,
      details: error.details
    } : {})
  }));
};

router.get('/vela/capabilities', (_req, res) => {
  res.json({
    service: 'vela-control',
    protocolVersion: VELA_CONTROL_PROTOCOL_VERSION,
    capabilities: VELA_CONTROL_CAPABILITIES
  });
});

router.get('/vela/profiles', (req, res) => {
  try { res.json(runtime(req).profiles.list({ type: req.query.type })); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/portable-backup/export', (req, res) => {
  try {
    const backup = runtime(req).portableBackup.export(req.body?.password);
    res.setHeader('Content-Type', 'application/vnd.vela.backup');
    res.setHeader('Content-Disposition', 'attachment; filename="vela-portable-backup.vela-backup"');
    res.send(backup);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/portable-backup/import', (req, res) => {
  try {
    if (!req.body?.packageBase64) throw new Error('迁移包不能为空');
    res.json(runtime(req).portableBackup.import(Buffer.from(req.body.packageBase64, 'base64'), req.body?.password));
  } catch (error) { handleError(res, error); }
});

router.post('/vela/profiles', (req, res) => {
  try { res.status(201).json(runtime(req).createProfile(req.body)); }
  catch (error) { handleError(res, error); }
});

router.patch('/vela/profiles/:id', (req, res) => {
  try { res.json(runtime(req).updateProfile(req.params.id, req.body)); }
  catch (error) { handleError(res, error); }
});

router.delete('/vela/profiles/:id', (req, res) => {
  try {
    if (!runtime(req).profiles.delete(req.params.id)) return res.status(404).json({ error: '账户不存在' });
    res.status(204).end();
  } catch (error) { handleError(res, error); }
});

router.post('/vela/profiles/:id/test', async (req, res) => {
  try { res.json(await runtime(req).testProfile(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/prompt-analysis', async (req, res) => {
  try { res.json(await runtime(req).analyzeBatchPrompt(req.body)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/prompt-templates', (req, res) => {
  try { res.json(runtime(req).promptTemplates.list()); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/prompt-templates', (req, res) => {
  try { res.status(201).json(runtime(req).promptTemplates.save(req.body)); }
  catch (error) { handleError(res, error); }
});

router.delete('/vela/prompt-templates/:id', (req, res) => {
  try {
    if (!runtime(req).promptTemplates.delete(req.params.id)) return res.status(404).json({ error: '提示词模板不存在' });
    res.status(204).end();
  } catch (error) { handleError(res, error); }
});

router.get('/vela/comfy/:id/status', async (req, res) => {
  try { res.json(await runtime(req).getComfyStatus(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/comfy/:id/power', (req, res) => {
  try { res.json(runtime(req).getCloudPowerState(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/comfy/:id/power/test', async (req, res) => {
  try { res.json(await runtime(req).testCloudPower(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/cloud-account', async (req, res) => {
  try { res.json(await runtime(req).getCloudAccountOverview()); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/data-dashboard', async (req, res) => {
  try { res.json(await runtime(req).getDataDashboardOverview()); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/projects', (req, res) => {
  try {
    const service = runtime(req);
    res.json(service.batchWorkflows.decorateProjectSummaries(service.projectStore.listProjects()));
  }
  catch (error) { handleError(res, error); }
});

router.get('/vela/batches', (req, res) => {
  try { res.json(runtime(req).batchWorkflows.listBatches()); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/batches', (req, res) => {
  try { res.status(201).json(runtime(req).batchWorkflows.createBatch(req.body)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/batches/:id', (req, res) => {
  try {
    const batch = runtime(req).batchWorkflows.getBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    res.json(batch);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/batches/:id/start', (req, res) => {
  try { res.status(202).json(runtime(req).batchWorkflows.startBatch(req.params.id, req.body)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/batches/:id/sync', (req, res) => {
  try {
    const availableTargets = [
      { id: 'storyworks', name: '编导车间（Storyworks）', kind: 'built-in' },
      ...(req.app.locals.pairingService?.listClients?.() || []).map((client) => ({ ...client, kind: 'paired' }))
    ];
    const requestedIds = req.body?.targetIds === undefined
      ? ['storyworks']
      : [...new Set(Array.isArray(req.body.targetIds) ? req.body.targetIds.map(String) : [])];
    if (!requestedIds.length) throw new Error('请至少选择一个同步软件');
    const availableById = new Map(availableTargets.map((target) => [target.id, target]));
    const unknownId = requestedIds.find((id) => !availableById.has(id));
    if (unknownId) throw new Error(`同步软件无效或已断开：${unknownId}`);
    const targets = requestedIds.map((id) => availableById.get(id));
    const { manifestPath: _manifestPath, ...result } = runtime(req).batchWorkflows.syncBatch(req.params.id, { targets });
    res.json(result);
  } catch (error) { handleError(res, error); }
});

router.get('/vela/batches/:id/sync-manifest', (req, res) => {
  try {
    const queryTargetId = typeof req.query.targetId === 'string' ? req.query.targetId : '';
    if (!req.velaClient && queryTargetId && queryTargetId !== 'storyworks') {
      return res.status(401).json({ error: '读取外部软件同步清单需要对应的连接凭据' });
    }
    if (req.velaClient && queryTargetId && queryTargetId !== req.velaClient.id) {
      const legacyStoryworksRead = queryTargetId === 'storyworks' && !isMaterialsReadOnlyClient(req.velaClient);
      if (!legacyStoryworksRead) return res.status(403).json({ error: '当前软件不能读取其他软件的同步清单' });
    }
    const targetId = queryTargetId
      || (isMaterialsReadOnlyClient(req.velaClient) ? req.velaClient.id : 'storyworks');
    const manifest = runtime(req).batchWorkflows.getSyncManifest(req.params.id, targetId);
    if (!manifest) return res.status(404).json({ error: '该批次尚未同步到当前软件' });
    res.json(manifest);
  } catch (error) { handleError(res, error); }
});

router.get('/vela/sync-inbox', (req, res) => {
  try {
    if (!req.velaClient) return res.status(401).json({ error: '同步收件箱仅允许已配对软件读取' });
    res.json(runtime(req).batchWorkflows.listSyncInbox(req.velaClient.id, {
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : '0',
      limit: typeof req.query.limit === 'string' ? req.query.limit : 500
    }));
  } catch (error) { handleError(res, error); }
});

router.post('/vela/sync-inbox/:batchId/ack', (req, res) => {
  try {
    if (!req.velaClient) return res.status(401).json({ error: '同步收件箱仅允许已配对软件确认' });
    res.json(runtime(req).batchWorkflows.acknowledgeSyncInbox(
      req.velaClient.id,
      req.params.batchId,
      req.body?.sourceKeys
    ));
  } catch (error) { handleError(res, error); }
});

router.post('/vela/projects', (req, res) => {
  try { res.status(201).json(runtime(req).projectStore.saveProject(req.body)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/projects/import', (req, res) => {
  try {
    const project = req.body.packageBase64
      ? runtime(req).projectStore.importProjectPackage(Buffer.from(req.body.packageBase64, 'base64'), { name: req.body.name })
      : runtime(req).projectStore.importProject(req.body.archive, { name: req.body.name });
    res.status(201).json(project);
  }
  catch (error) { handleError(res, error); }
});

router.get('/vela/projects/:id', (req, res) => {
  try {
    const service = runtime(req);
    const project = service.batchWorkflows.reconcileProject(req.params.id)
      || service.projectStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    res.json(project);
  } catch (error) { handleError(res, error); }
});

router.put('/vela/projects/:id', (req, res) => {
  try { res.json(runtime(req).projectStore.saveProject({ ...req.body, id: req.params.id })); }
  catch (error) { handleError(res, error); }
});

router.patch('/vela/projects/:id', (req, res) => {
  try {
    const project = runtime(req).projectStore.renameProject(req.params.id, req.body?.name);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    res.json(project);
  } catch (error) { handleError(res, error); }
});

router.delete('/vela/projects/:id', (req, res) => {
  try {
    const service = runtime(req);
    if (!service.projectStore.getProject(req.params.id)) return res.status(404).json({ error: '项目不存在' });
    const activeJobCount = service.jobs.countActiveJobsForProject(req.params.id);
    if (activeJobCount) {
      return res.status(409).json({ error: `项目仍有 ${activeJobCount} 个生成任务，完成或取消后才能删除。` });
    }
    if (service.batchWorkflows.hasPendingSyncForProject(req.params.id)) {
      return res.status(409).json({ error: '项目成品仍在等待同步软件接收，完成同步确认后才能删除。' });
    }
    const deleted = service.projectStore.deleteProject(req.params.id);
    if (!deleted) return res.status(404).json({ error: '项目不存在' });
    res.status(204).end();
  } catch (error) { handleError(res, error); }
});

router.get('/vela/workflows', (req, res) => {
  try { res.json(runtime(req).workflowTemplates.list()); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/workflows', (req, res) => {
  try { res.status(201).json(runtime(req).workflowTemplates.save(req.body)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/workflows/:id', (req, res) => {
  try {
    const template = runtime(req).workflowTemplates.get(req.params.id);
    if (!template) return res.status(404).json({ error: '工作流不存在' });
    res.json(template);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/workflows/:id/instantiate', (req, res) => {
  try {
    const template = runtime(req).workflowTemplates.instantiate(req.params.id, {
      projectId: req.body?.projectId
    });
    if (!template) return res.status(404).json({ error: 'Workflow does not exist' });
    res.status(201).json(template);
  } catch (error) { handleError(res, error); }
});

router.delete('/vela/workflows/:id', (req, res) => {
  try {
    if (!runtime(req).workflowTemplates.delete(req.params.id)) return res.status(404).json({ error: '工作流不存在' });
    res.status(204).end();
  } catch (error) { handleError(res, error); }
});

router.get('/vela/ecommerce-workflows', (req, res) => {
  try { res.json(runtime(req).ecommerceWorkflows.list()); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/ecommerce-workflows/:id/instantiate', (req, res) => {
  try {
    const project = runtime(req).ecommerceWorkflows.createProject(req.params.id);
    if (!project) return res.status(404).json({ error: '电商工作流不存在或已删除' });
    res.status(201).json(project);
  } catch (error) { handleError(res, error); }
});

router.delete('/vela/ecommerce-workflows/:id', (req, res) => {
  try {
    if (!runtime(req).ecommerceWorkflows.delete(req.params.id)) {
      return res.status(404).json({ error: '电商工作流不存在或已删除' });
    }
    res.status(204).end();
  } catch (error) { handleError(res, error); }
});

router.get('/vela/projects/:id/media', (req, res) => {
  try { res.json(runtime(req).media.list(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/projects/:id/media', (req, res) => {
  try {
    res.status(201).json(runtime(req).media.saveUploadedMedia(req.params.id, {
      dataUrl: req.body?.data,
      fileName: req.body?.fileName
    }));
  } catch (error) { handleError(res, error); }
});

router.get('/vela/projects/:id/media/:mediaId/file', (req, res) => {
  try {
    if (isMaterialsReadOnlyClient(req.velaClient) && !runtime(req).batchWorkflows.isMediaReferencedForTarget(
      req.velaClient.id,
      req.params.id,
      req.params.mediaId
    )) {
      return res.status(403).json({ error: '当前素材不在该软件的同步清单中' });
    }
    const resolved = runtime(req).media.resolveFile(req.params.id, req.params.mediaId);
    if (!resolved || !fs.existsSync(resolved.filePath)) return res.status(404).json({ error: '媒体不存在' });
    res.setHeader('Content-Type', resolved.record.mime || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(resolved.filePath).size);
    res.sendFile(resolved.filePath);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/projects/:id/export', (req, res) => {
  try {
    const options = { includeMedia: Boolean(req.body?.includeMedia) };
    if (req.body?.download) {
      const packageBuffer = runtime(req).projectStore.exportProjectPackage(req.params.id, options);
      if (!packageBuffer) return res.status(404).json({ error: '项目不存在' });
      res.setHeader('Content-Type', 'application/vnd.vela.project');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.vela"`);
      return res.send(packageBuffer);
    }
    const archive = runtime(req).projectStore.exportProject(req.params.id, options);
    if (!archive) return res.status(404).json({ error: '项目不存在' });
    res.json(archive);
  } catch (error) { handleError(res, error); }
});

router.get('/vela/jobs', (req, res) => {
  try {
    res.json(runtime(req).jobs.listJobs({
      status: req.query.status,
      profileId: req.query.profileId,
      groupId: req.query.groupId,
      limit: req.query.limit,
      newestFirst: req.query.order === 'recent'
    }));
  } catch (error) { handleError(res, error); }
});

router.post('/vela/jobs', (req, res) => {
  try { res.status(202).json(runtime(req).createJobGroup(req.body)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/jobs/by-external-key/:key', (req, res) => {
  try {
    const result = runtime(req).getJobGroupByExternalKey(req.params.key);
    if (!result) return res.status(404).json({ error: '外部任务不存在' });
    res.json(result);
  } catch (error) { handleError(res, error); }
});

router.put('/vela/jobs/by-external-key/:key', (req, res) => {
  try {
    const { contractFingerprint, ...draft } = req.body || {};
    const result = runtime(req).createOrGetJobGroup(req.params.key, contractFingerprint, draft);
    res.status(result.created ? 202 : 200).json(result);
  } catch (error) { handleError(res, error); }
});

router.get('/vela/jobs/:id', (req, res) => {
  try {
    const job = runtime(req).jobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json(job);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/jobs/:id/retry', (req, res) => {
  try { res.json(runtime(req).retryJob(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.post('/vela/jobs/:id/cancel', (req, res) => {
  try { res.json(runtime(req).cancelJob(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/job-groups/:id', (req, res) => {
  try {
    const group = runtime(req).jobs.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: '批次不存在' });
    res.json(group);
  } catch (error) { handleError(res, error); }
});

router.post('/vela/job-groups/:id/retry-failed', (req, res) => {
  try { res.json({ jobs: runtime(req).retryFailedGroup(req.params.id) }); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/events', (req, res) => runtime(req).eventHub.createSseHandler()(req, res));

export default router;
