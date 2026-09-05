import { AppWindow, CheckCircle2, CircleAlert, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { getVelaConnectionInfo } from '../services/connectionService';
import type { BatchSyncResult, BatchSyncTargetResult, BatchWorkflow } from '../services/batchWorkflowService';

const STORAGE_KEY = 'vela-batch-sync-targets';
const STORYWORKS_TARGET = { id: 'storyworks', name: '编导车间（Storyworks）', kind: 'built-in' as const };

interface SyncTarget {
  id: string;
  name: string;
  kind: 'built-in' | 'paired';
  createdAt?: string;
}

interface VelaSyncTargetsDialogProps {
  open: boolean;
  batch: BatchWorkflow | null;
  onClose: () => void;
  onSync: (targetIds: string[]) => Promise<BatchSyncResult>;
}

const readRememberedTargets = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch { return []; }
};

export function VelaSyncTargetsDialog({ open, batch, onClose, onSync }: VelaSyncTargetsDialogProps) {
  const [targets, setTargets] = useState<SyncTarget[]>([STORYWORKS_TARGET]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['storyworks']));
  const [results, setResults] = useState<BatchSyncTargetResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const allSelected = targets.length > 0 && targets.every((target) => selectedIds.has(target.id));
  const resultById = useMemo(() => new Map(results.map((result) => [result.id, result])), [results]);

  const loadTargets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const info = await getVelaConnectionInfo();
      const nextTargets: SyncTarget[] = [STORYWORKS_TARGET, ...(info.clients || []).map((client) => ({ ...client, kind: 'paired' as const }))];
      const availableIds = new Set(nextTargets.map((target) => target.id));
      const remembered = readRememberedTargets().filter((id) => availableIds.has(id));
      setTargets(nextTargets);
      setSelectedIds(new Set(remembered.length ? remembered : ['storyworks']));
    } catch (reason) {
      setTargets([STORYWORKS_TARGET]);
      setSelectedIds(new Set(['storyworks']));
      setError(reason instanceof Error ? reason.message : '无法读取已连接软件');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResults([]);
    void loadTargets();
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => previousFocusRef.current?.focus();
  }, [loadTargets, open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !syncing) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open, syncing]);

  if (!open || !batch) return null;

  const toggleTarget = (id: string) => {
    setResults([]);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setResults([]);
    setSelectedIds(allSelected ? new Set() : new Set(targets.map((target) => target.id)));
  };
  const submit = async () => {
    const targetIds = targets.filter((target) => selectedIds.has(target.id)).map((target) => target.id);
    if (!targetIds.length) return setError('请至少选择一个同步软件');
    try {
      setSyncing(true);
      setError(null);
      const result = await onSync(targetIds);
      setResults(result.targets);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(targetIds));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同步失败');
    } finally { setSyncing(false); }
  };
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="vela-batch-sync-dialog__backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !syncing && onClose()}>
      <section ref={dialogRef} className="vela-batch-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-sync-dialog-title" aria-describedby="vela-sync-dialog-description" onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="vela-batch-sync-dialog__icon"><Send size={19} /></span>
          <div><h2 id="vela-sync-dialog-title">选择同步软件</h2><p id="vela-sync-dialog-description">“{batch.name}”将分别生成同步清单，现有项目和素材不会被覆盖。</p></div>
          <button ref={closeRef} type="button" aria-label="关闭同步窗口" onClick={onClose} disabled={syncing}><X size={18} /></button>
        </header>

        <div className="vela-batch-sync-dialog__toolbar">
          <div><strong>{selectedIds.size}</strong><span> / {targets.length} 个软件已选择</span></div>
          <button type="button" onClick={toggleAll} disabled={loading || syncing}>{allSelected ? '取消全选' : '选择全部'}</button>
          <button type="button" aria-label="刷新已连接软件" onClick={() => void loadTargets()} disabled={loading || syncing}><RefreshCw className={loading ? 'vela-spin' : undefined} size={15} />刷新</button>
        </div>

        <div className="vela-batch-sync-dialog__list" aria-busy={loading}>
          {loading && <div className="vela-batch-sync-dialog__loading"><Loader2 className="vela-spin" size={20} />正在读取已连接软件…</div>}
          {!loading && targets.map((target) => {
            const result = resultById.get(target.id);
            return <label key={target.id} className="vela-batch-sync-dialog__target" data-selected={selectedIds.has(target.id) || undefined}>
              <input type="checkbox" checked={selectedIds.has(target.id)} onChange={() => toggleTarget(target.id)} disabled={syncing} />
              <span className="vela-batch-sync-dialog__app-icon"><AppWindow size={18} /></span>
              <span className="vela-batch-sync-dialog__target-copy"><strong>{target.name}</strong><small>{target.kind === 'built-in' ? '内置兼容通道' : `已连接 · 标识 ${target.id.slice(0, 8)}${target.createdAt ? ` · ${new Date(target.createdAt).toLocaleDateString('zh-CN')}` : ''}`}</small></span>
              {result?.status === 'succeeded' && <span className="vela-batch-sync-dialog__result" data-status="succeeded"><CheckCircle2 size={15} />成功</span>}
              {result?.status === 'failed' && <span className="vela-batch-sync-dialog__result" data-status="failed" title={result.error}><CircleAlert size={15} />失败</span>}
            </label>;
          })}
          {!loading && targets.length === 1 && <div className="vela-batch-sync-dialog__hint">其他软件尚未连接。请先在“设置 → 外部软件连接”中使用连接码完成配对。</div>}
        </div>

        {error && <p className="vela-batch-sync-dialog__error" role="alert">{error}</p>}
        {results.length > 0 && <p className="vela-batch-sync-dialog__summary" role="status">成功 {results.filter((item) => item.status === 'succeeded').length} 个，失败 {results.filter((item) => item.status === 'failed').length} 个。</p>}
        <footer>
          <button type="button" onClick={onClose} disabled={syncing}>{results.length ? '完成' : '取消'}</button>
          <button type="button" data-primary="true" onClick={() => void submit()} disabled={loading || syncing || selectedIds.size === 0}>{syncing ? <Loader2 className="vela-spin" size={16} /> : <Send size={16} />}{results.length ? '再次同步' : `同步到 ${selectedIds.size} 个软件`}</button>
        </footer>
      </section>
    </div>
  );
}
