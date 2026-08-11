import express from 'express';
import fs from 'node:fs';

import { ContractValidationError } from '../../shared/vela-contracts.js';
import { ProviderError } from '../providers/openAiCompatibleProvider.js';
import { ComfyUiError } from '../providers/comfyUiProvider.js';
import { redactSecrets } from '../vela/redaction.js';

const router = express.Router();

const runtime = (req) => {
  if (!req.app.locals.velaRuntime) throw new Error('Vela runtime is not configured');
  return req.app.locals.velaRuntime;
};

const handleError = (res, error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const providerError = error instanceof ProviderError || error instanceof ComfyUiError;
  const status = providerError
    ? error.code === 'AUTH_FAILED' ? 401
      : ['MODEL_NOT_FOUND', 'CREDENTIAL_UNREADABLE', 'CREDENTIAL_MISSING'].includes(error.code) ? 422
        : 502
    : error instanceof ContractValidationError || /invalid|unsupported|required|cannot|不能为空|not found|不支持|无效|上传内容/i.test(message) ? 400 : 500;
  res.status(status).json(redactSecrets({
    error: message,
    ...(providerError ? {
      code: error.code,
      retryable: error.retryable,
      safeToRetry: error.safeToRetry,
      details: error.details
    } : {})
  }));
};

router.get('/vela/profiles', (req, res) => {
  try { res.json(runtime(req).profiles.list({ type: req.query.type })); }
  catch (error) { handleError(res, error); }
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

router.get('/vela/comfy/:id/status', async (req, res) => {
  try { res.json(await runtime(req).getComfyStatus(req.params.id)); }
  catch (error) { handleError(res, error); }
});

router.get('/vela/projects', (req, res) => {
  try { res.json(runtime(req).projectStore.listProjects()); }
  catch (error) { handleError(res, error); }
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
    const project = runtime(req).projectStore.getProject(req.params.id);
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
    const deleted = runtime(req).projectStore.deleteProject(req.params.id);
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

router.delete('/vela/workflows/:id', (req, res) => {
  try {
    if (!runtime(req).workflowTemplates.delete(req.params.id)) return res.status(404).json({ error: '工作流不存在' });
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
      limit: req.query.limit
    }));
  } catch (error) { handleError(res, error); }
});

router.post('/vela/jobs', (req, res) => {
  try { res.status(202).json(runtime(req).createJobGroup(req.body)); }
  catch (error) { handleError(res, error); }
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
