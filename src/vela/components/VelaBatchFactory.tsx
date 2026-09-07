import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Images,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
  UploadCloud,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS } from '../generationOptions';
import {
  createBatchWorkflow,
  getBatchWorkflow,
  listBatchWorkflows,
  startBatchWorkflow,
  syncBatchWorkflow,
  type BatchWorkflow,
  type BatchWorkflowItem
} from '../services/batchWorkflowService';
import type { VelaProfile } from '../services/profileService';
import { VelaSyncTargetsDialog } from './VelaSyncTargetsDialog';
import { VelaPromptWorkbench } from './VelaPromptWorkbench';
import { getBatchImageValidationError } from '../batchImageValidation';
import './VelaBatchFactory.css';

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface VelaBatchFactoryProps {
  profiles: VelaProfile[];
  onOpenProject: (projectId: string) => Promise<void>;
  onOpenApi: () => void;
  onProjectsChanged: () => void | Promise<void>;
}

const MAX_FILES = 50;
const MAX_TOTAL_FILE_BYTES = 192 * 1024 * 1024;
const DEFAULT_PROMPT = '将人物正在穿着的裤子改成纯黑色。保持裤子的款式、材质纹理、褶皱和版型真实，人物身份、肤色、上衣、鞋子、姿势、背景、构图和光线不变。不要新增文字、水印或其他物体。';
const BENCHMARK_PROMPT = '将商品原图中裤子的颜色、版型、面料纹理和设计细节准确应用到对标图人物身上。保持对标图中的人物身份、五官、发型、体型、姿势、上衣、鞋子、配饰、背景、构图、镜头、光线和文字排版不变；除裤子外不要修改任何内容。';
const DEFAULT_POSE_PROMPT = '基于已经确认满意的主图，生成自然、松弛且互不重复的人物姿势。只改变人物姿势，不改变人物、服装、背景、构图、镜头、光线、文字或任何其他细节。';

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error(`无法读取“${file.name}”`));
  reader.readAsDataURL(file);
});

const STATUS_COPY: Record<BatchWorkflowItem['status'], string> = {
  draft: '待开始',
  submitted: '已提交',
  running: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  cancelled: '已取消'
};

export function VelaBatchFactory({ profiles, onOpenProject, onOpenApi, onProjectsChanged }: VelaBatchFactoryProps) {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [benchmark, setBenchmark] = useState<PendingImage | null>(null);
  const [name, setName] = useState('黑裤换色');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [profileId, setProfileId] = useState('');
  const [aspectRatio, setAspectRatio] = useState('3:4');
  const [resolution, setResolution] = useState('2K');
  const [outputCount, setOutputCount] = useState(1);
  const [poseEnabled, setPoseEnabled] = useState(true);
  const [poseOutputCount, setPoseOutputCount] = useState(5);
  const [posePrompt, setPosePrompt] = useState(DEFAULT_POSE_PROMPT);
  const [promptWorkbenchResetToken, setPromptWorkbenchResetToken] = useState(0);
  const [batches, setBatches] = useState<BatchWorkflow[]>([]);
  const [activeBatchId, setActiveBatchId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'create' | 'start' | 'sync' | 'refresh' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const benchmarkInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const startRequestInFlightRef = useRef(false);

  const imageProfiles = useMemo(() => profiles.filter((profile) => profile.type === 'gpt' && Boolean(profile.models.image)), [profiles]);
  const activeBatch = batches.find((batch) => batch.id === activeBatchId) || null;
  const activeBatchHasRunningItems = Boolean(
    activeBatch?.items.some((item) => ['submitted', 'running'].includes(item.status))
  );
  const startableItems = activeBatch?.items.filter((item) => ['draft', 'failed'].includes(item.status)) || [];
  const selectedStartableIds = startableItems.filter((item) => selectedIds.has(item.id)).map((item) => item.id);

  useEffect(() => {
    if (!profileId && imageProfiles[0]) setProfileId(imageProfiles[0].id);
  }, [imageProfiles, profileId]);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  const refreshBatches = useCallback(async (showBusy = false) => {
    try {
      if (showBusy) setBusyAction('refresh');
      const next = await listBatchWorkflows();
      setBatches(next);
      setActiveBatchId((current) => current && next.some((batch) => batch.id === current) ? current : next[0]?.id || '');
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取批次');
    } finally {
      if (showBusy) setBusyAction(null);
    }
  }, []);

  useEffect(() => { void refreshBatches(); }, [refreshBatches]);
  useEffect(() => {
    if (!activeBatchId || !activeBatchHasRunningItems) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const refreshed = await getBatchWorkflow(activeBatchId);
        if (!cancelled) {
          setBatches((current) => current.map((batch) => batch.id === refreshed.id ? refreshed : batch));
        }
      } catch { /* The next manual refresh gives a visible retry path. */ }
      finally {
        if (!cancelled) timer = window.setTimeout(poll, 2000);
      }
    };
    timer = window.setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeBatchId, activeBatchHasRunningItems]);

  useEffect(() => {
    if (!activeBatch) return;
    setSelectedIds(new Set(activeBatch.items.filter((item) => item.status === 'draft').map((item) => item.id)));
  }, [activeBatch?.id]);

  const addFiles = (files: File[]) => {
    setMessage(null);
    setError(null);
    const existing = new Set(pending.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const accepted = files.filter((file) => !getBatchImageValidationError(file, 'source') && !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
    const firstValidationError = files.map((file) => getBatchImageValidationError(file, 'source')).find(Boolean);
    if (firstValidationError) setError(firstValidationError);
    const available = Math.max(0, MAX_FILES - pending.length);
    const next = accepted.slice(0, available).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    if (accepted.length > available) setError(`单批最多 ${MAX_FILES} 张，多出的图片未加入。`);
    setPending((current) => [...current, ...next]);
  };

  const removePending = (id: string) => setPending((current) => current.filter((item) => {
    if (item.id !== id) return true;
    URL.revokeObjectURL(item.previewUrl);
    previewUrlsRef.current.delete(item.previewUrl);
    return false;
  }));

  const addBenchmark = (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setError(null);
    const validationError = getBatchImageValidationError(file, 'benchmark');
    if (validationError) {
      setError(validationError);
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current.add(previewUrl);
    setBenchmark((current) => {
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
        previewUrlsRef.current.delete(current.previewUrl);
      }
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    setPrompt((current) => current === DEFAULT_PROMPT ? BENCHMARK_PROMPT : current);
  };

  const removeBenchmark = () => {
    setBenchmark((current) => {
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
        previewUrlsRef.current.delete(current.previewUrl);
      }
      return null;
    });
    setPrompt((current) => current === BENCHMARK_PROMPT ? DEFAULT_PROMPT : current);
    if (benchmarkInputRef.current) benchmarkInputRef.current.value = '';
  };

  const createNewDraft = () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
    setPending([]);
    setBenchmark(null);
    setName('黑裤换色');
    setPrompt(DEFAULT_PROMPT);
    setProfileId(imageProfiles[0]?.id || '');
    setAspectRatio('3:4');
    setResolution('2K');
    setOutputCount(1);
    setPoseEnabled(true);
    setPoseOutputCount(5);
    setPosePrompt(DEFAULT_POSE_PROMPT);
    setPromptWorkbenchResetToken((current) => current + 1);
    setActiveBatchId('');
    setSelectedIds(new Set());
    setError(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = '';
    if (benchmarkInputRef.current) benchmarkInputRef.current.value = '';
  };

  const runCreate = async () => {
    if (!pending.length || !name.trim() || !prompt.trim() || !profileId || (poseEnabled && !posePrompt.trim())) {
      setError('请先添加图片，并完整填写项目名称、提示词和大模型账户。');
      return;
    }
    const totalBytes = pending.reduce((total, item) => total + item.file.size, 0) + (benchmark?.file.size || 0);
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      setError('单批图片总大小不能超过 192MB，请分成多个批次导入。');
      return;
    }
    try {
      setBusyAction('create');
      setError(null);
      setMessage('正在读取图片，并在一个项目内建立独立工作流…');
      const images: Array<{ name: string; data: string }> = [];
      for (const { file } of pending) {
        images.push({ name: file.name, data: await readFileAsDataUrl(file) });
      }
      const benchmarkImage = benchmark
        ? { name: benchmark.file.name, data: await readFileAsDataUrl(benchmark.file) }
        : null;
      const created = await createBatchWorkflow({
        name: name.trim(),
        prompt: prompt.trim(),
        profileId,
        aspectRatio,
        resolution,
        outputCount,
        images,
        benchmarkImage,
        poseVariation: { enabled: poseEnabled, prompt: posePrompt.trim(), outputCount: poseOutputCount }
      });
      setBatches((current) => [created, ...current.filter((batch) => batch.id !== created.id)]);
      setActiveBatchId(created.id);
      setSelectedIds(new Set(created.items.map((item) => item.id)));
      await onProjectsChanged();
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      setPending([]);
      setBenchmark(null);
      setMessage(`已在“${created.projectName || created.name}”项目中创建 ${created.items.length} 个独立工作流${created.poseVariation?.enabled ? '，并添加姿势裂变后缀' : ''}。确认勾选项后再批量开始生成。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量创建失败');
      setMessage(null);
    } finally { setBusyAction(null); }
  };

  const runStart = async () => {
    if (startRequestInFlightRef.current || !activeBatch || !selectedStartableIds.length) return;
    startRequestInFlightRef.current = true;
    try {
      setBusyAction('start');
      setError(null);
      const result = await startBatchWorkflow(activeBatch.id, selectedStartableIds);
      setBatches((current) => current.map((batch) => batch.id === result.batch.id ? result.batch : batch));
      setMessage(`已开始 ${result.started} 个工作流${result.skipped ? `，跳过 ${result.skipped} 个已提交工作流` : ''}。`);
      if (result.errors.length) setError(`${result.errors.length} 个项目未能启动：${result.errors[0].message}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量开始失败');
    } finally {
      startRequestInFlightRef.current = false;
      setBusyAction(null);
    }
  };

  const runSync = async (targetIds: string[]) => {
    if (!activeBatch) throw new Error('请先选择一个批次');
    try {
      setBusyAction('sync');
      setError(null);
      const result = await syncBatchWorkflow(activeBatch.id, targetIds);
      await refreshBatches();
      const succeeded = result.targets.filter((target) => target.status === 'succeeded').length;
      const failed = result.targets.length - succeeded;
      setMessage(`已同步到 ${succeeded} 个软件：${new Date(result.syncedAt).toLocaleString('zh-CN')}${failed ? `，${failed} 个失败` : ''}`);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同步失败');
      throw reason;
    } finally { setBusyAction(null); }
  };

  return (
    <>
    <main className="vela-batch" aria-label="批量工厂">
      <header className="vela-batch__heading">
        <button type="button" className="vela-batch__new-project" onClick={createNewDraft} disabled={Boolean(busyAction)}><Plus size={17} aria-hidden="true" />新建项目</button>
        <div className="vela-batch__heading-count"><strong>{pending.length || activeBatch?.items.length || 0}</strong><span>张 / 工作流</span></div>
      </header>

      {error && <div className="vela-batch__alert" role="alert">{error}</div>}
      {message && <div className="vela-batch__notice" role="status">{message}</div>}

      <section className="vela-batch__builder" aria-label="创建批量工作流">
        <div className="vela-batch__step"><span>1</span><div><h2>添加原图与对标图</h2><p>原图一张对应一个工作流；对标图会共享给本批次的全部工作流。</p></div></div>
        <div className="vela-batch__input-grid">
          <div className="vela-batch__upload-panel">
            <div className="vela-batch__upload-label"><strong>批量原图</strong><span>最多 50 张</span></div>
            <div
              className="vela-batch__dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}
            >
              <input ref={inputRef} type="file" accept="image/*" multiple onChange={(event) => { addFiles([...(event.target.files || [])]); event.target.value = ''; }} />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(busyAction)}><UploadCloud size={22} /><span>选择或拖入多张原图</span><small>每张建立一条工作流</small></button>
            </div>
          </div>
          <div className="vela-batch__upload-panel">
            <div className="vela-batch__upload-label"><strong>对标图</strong><span>可选 · 全批共享</span></div>
            <div
              className="vela-batch__benchmark"
              data-has-image={Boolean(benchmark)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addBenchmark(event.dataTransfer.files[0]); }}
            >
              <input ref={benchmarkInputRef} type="file" accept="image/*" onChange={(event) => { addBenchmark(event.target.files?.[0]); event.target.value = ''; }} />
              {benchmark ? <>
                <img src={benchmark.previewUrl} alt={`对标图 ${benchmark.file.name}`} />
                <div><strong>{benchmark.file.name}</strong><span>每条主图工作流都会连接这张图</span></div>
                <button type="button" className="vela-batch__benchmark-replace" onClick={() => benchmarkInputRef.current?.click()} disabled={Boolean(busyAction)}>替换</button>
                <button type="button" className="vela-batch__benchmark-remove" onClick={removeBenchmark} aria-label={`移除对标图 ${benchmark.file.name}`} disabled={Boolean(busyAction)}><X size={14} /></button>
              </> : <button type="button" onClick={() => benchmarkInputRef.current?.click()} disabled={Boolean(busyAction)}><Images size={22} /><span>上传一张对标图</span><small>用于人物、姿势、背景和版式参考</small></button>}
            </div>
          </div>
        </div>
        {pending.length > 0 && <div className="vela-batch__filmstrip" aria-label={`已选择 ${pending.length} 张图片`}>
          {pending.map((item, index) => <figure key={item.id}><img src={item.previewUrl} alt={item.file.name} /><figcaption><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.file.name}</strong></figcaption><button type="button" onClick={() => removePending(item.id)} aria-label={`移除 ${item.file.name}`}><X size={14} /></button></figure>)}
        </div>}

        <div className="vela-batch__step"><span>2</span><div><h2>设置共享参数</h2><p>这些设置会准确复制到每一个图生图节点。</p></div></div>
        <div className="vela-batch__form-grid">
          <label><span>项目名称</span><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="例如：黑裤换色" /></label>
          <label><span>大模型 / 账户</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">请选择图片模型</option>{imageProfiles.map((profile) => profile.type === 'gpt' && <option key={profile.id} value={profile.id}>{profile.name} · {profile.models.image}</option>)}</select>{imageProfiles.length === 0 && <button className="vela-batch__inline-link" type="button" onClick={onOpenApi}>先去 API 页面配置图片模型</button>}</label>
          <label><span>画面比例</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{IMAGE_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
          <label><span>清晰度</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}>{IMAGE_RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>每图生成张数</span><select value={outputCount} onChange={(event) => setOutputCount(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
          <div className="vela-batch__prompt"><VelaPromptWorkbench resetToken={promptWorkbenchResetToken} prompt={prompt} onPromptChange={setPrompt} productImages={pending} benchmarkImage={benchmark} profiles={profiles} onOpenApi={onOpenApi} /></div>
        </div>

        <div className="vela-batch__step"><span>3</span><div><h2>添加后缀工作流</h2><p>主图满意后再启动后缀，一次裂变不同姿势，不自动扣费。</p></div></div>
        <div className="vela-batch__suffix" data-enabled={poseEnabled}>
          <label className="vela-batch__suffix-toggle">
            <input type="checkbox" checked={poseEnabled} onChange={(event) => setPoseEnabled(event.target.checked)} />
            <span><strong>姿势裂变</strong><small>在每条主图后增加一个“只换姿势”节点</small></span>
          </label>
          <label><span>裂变张数</span><select value={poseOutputCount} onChange={(event) => setPoseOutputCount(Number(event.target.value))} disabled={!poseEnabled}>{Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
          <label className="vela-batch__suffix-prompt"><span>姿势裂变提示词</span><textarea value={posePrompt} maxLength={4000} onChange={(event) => setPosePrompt(event.target.value)} disabled={!poseEnabled} /></label>
        </div>

        <div className="vela-batch__create-bar"><div><span>4</span><p><strong>只创建，不扣费</strong>先批量生成主图，满意后再到画布启动姿势裂变。</p></div><button type="button" onClick={() => void runCreate()} disabled={Boolean(busyAction) || !pending.length || !profileId}>{busyAction === 'create' ? <Loader2 className="vela-spin" size={17} /> : <Images size={17} />}创建 {pending.length || 0} 个工作流</button></div>
      </section>

      <section className="vela-batch__runs" aria-labelledby="vela-batch-runs-title">
        <header><div><h2 id="vela-batch-runs-title">批次控制台</h2><p>勾选待开始项目后统一生成；已提交项目不会重复启动。</p></div><div className="vela-batch__run-tools"><select aria-label="选择批次" value={activeBatchId} onChange={(event) => setActiveBatchId(event.target.value)}><option value="">还没有批次</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.items.length} 个 · {new Date(batch.createdAt).toLocaleDateString('zh-CN')}</option>)}</select><button type="button" aria-label="刷新批次" onClick={() => void refreshBatches(true)} disabled={Boolean(busyAction)}><RefreshCw className={busyAction === 'refresh' ? 'vela-spin' : ''} size={16} /></button></div></header>
        {!activeBatch ? <div className="vela-batch__empty"><Clock3 size={24} /><strong>创建后的独立工作流会显示在这里</strong><span>所有工作流属于同一个项目，创建动作不会自动调用模型。</span></div> : <>
          <BatchItems batch={activeBatch} selectedIds={selectedIds} onSelectionChange={setSelectedIds} onOpenProject={onOpenProject} />
          <footer className="vela-batch__actions"><div><span>同步目标</span><strong>点击选择一个或多个软件</strong>{(activeBatch.lastSync || activeBatch.sync) && <small><CheckCircle2 size={13} />上次同步 {new Date(activeBatch.lastSync?.syncedAt || activeBatch.sync!.syncedAt).toLocaleString('zh-CN')}{activeBatch.lastSync ? ` · ${activeBatch.lastSync.targets.filter((target) => target.status === 'succeeded').length} 个软件` : ''}</small>}</div><button type="button" className="vela-batch__sync" onClick={() => setSyncDialogOpen(true)} disabled={Boolean(busyAction)}>{busyAction === 'sync' ? <Loader2 className="vela-spin" size={16} /> : <Send size={16} />}一键同步</button><button type="button" className="vela-batch__start" onClick={() => void runStart()} disabled={Boolean(busyAction) || selectedStartableIds.length === 0}>{busyAction === 'start' ? <Loader2 className="vela-spin" size={17} /> : <Play size={17} />}批量开始生成（{selectedStartableIds.length}）</button></footer>
        </>}
      </section>
    </main>
    <VelaSyncTargetsDialog open={syncDialogOpen} batch={activeBatch} onClose={() => setSyncDialogOpen(false)} onSync={runSync} />
    </>
  );
}

function BatchItems({ batch, selectedIds, onSelectionChange, onOpenProject }: { batch: BatchWorkflow; selectedIds: Set<string>; onSelectionChange: (ids: Set<string>) => void; onOpenProject: (projectId: string) => Promise<void> }) {
  const startableIds = batch.items.filter((item) => ['draft', 'failed'].includes(item.status)).map((item) => item.id);
  const allSelected = startableIds.length > 0 && startableIds.every((id) => selectedIds.has(id));
  const toggleAll = () => onSelectionChange(allSelected ? new Set() : new Set(startableIds));
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };
  return <div className="vela-batch__table-wrap"><table className="vela-batch__table"><thead><tr><th><input type="checkbox" aria-label="选择全部待开始或生成失败的工作流" checked={allSelected} onChange={toggleAll} /></th><th>原图 / 工作流</th><th>参数</th><th>状态</th><th>结果</th><th><span className="vela-batch__sr-only">操作</span></th></tr></thead><tbody>{batch.items.map((item) => <tr key={item.id}><td><input type="checkbox" aria-label={`选择 ${item.workflowName || item.projectName}`} checked={selectedIds.has(item.id)} disabled={!['draft', 'failed'].includes(item.status)} onChange={() => toggleOne(item.id)} /></td><td><div className="vela-batch__project-cell"><img src={item.sourceUrl} alt="" /><span><strong>{item.workflowName || item.projectName}</strong><small>{item.sourceName}{item.benchmarkUrl ? ' · 含对标图' : ''}</small></span></div></td><td><span className="vela-batch__params"><strong>{batch.aspectRatio} · {batch.resolution} · 主图 {batch.outputCount} 张</strong>{batch.poseVariation?.enabled && <small>后缀 {batch.poseVariation.outputCount || 5} 张姿势</small>}</span></td><td><span className="vela-batch__status" data-status={item.status}>{item.status === 'succeeded' ? <CheckCircle2 size={14} /> : item.status === 'running' ? <Loader2 className="vela-spin" size={14} /> : item.status === 'failed' ? <TriangleAlert size={14} /> : <Clock3 size={14} />}{STATUS_COPY[item.status]}{item.status === 'running' && item.progress > 0 ? ` ${item.progress}%` : ''}</span></td><td>{item.outputs[0]?.url ? <img className="vela-batch__result" src={item.outputs[0].url} alt={`${item.workflowName || item.projectName} 生成结果`} /> : <span className="vela-batch__no-result">—</span>}</td><td><button type="button" className="vela-batch__open" onClick={() => void onOpenProject(item.projectId)}>{item.status === 'succeeded' && item.poseNodeId ? '打开并裂变' : '打开画布'}<ExternalLink size={13} /></button></td></tr>)}</tbody></table></div>;
}
