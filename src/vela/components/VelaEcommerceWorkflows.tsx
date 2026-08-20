import { ArrowUpRight, Loader2, Search, ShoppingBag, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteEcommerceWorkflow,
  listEcommerceWorkflows,
  type EcommerceWorkflowSummary
} from '../services/ecommerceWorkflowService';
import { WorkflowCanvasPreview } from './WorkflowCanvasPreview';

interface VelaEcommerceWorkflowsProps {
  busyWorkflowId: string | null;
  disabled?: boolean;
  onCreate: (workflowId: string) => void | Promise<void>;
}

type WorkflowFilter = 'all' | EcommerceWorkflowSummary['category'];

const FILTERS: Array<{ id: WorkflowFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'commerce', label: '电商视觉' },
  { id: 'outfit', label: '服装换装' },
  { id: 'video', label: '角色视频' },
  { id: 'portrait', label: '人物重绘' },
  { id: 'restore', label: '修复工具' }
];

export function VelaEcommerceWorkflows({ busyWorkflowId, disabled, onCreate }: VelaEcommerceWorkflowsProps) {
  const [workflows, setWorkflows] = useState<EcommerceWorkflowSummary[]>([]);
  const [filter, setFilter] = useState<WorkflowFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EcommerceWorkflowSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      setWorkflows(await listEcommerceWorkflows());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取电商工作流');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!deleteTarget) return;
    window.setTimeout(() => cancelDeleteRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deletingId) setDeleteTarget(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteTarget, deletingId]);

  const visibleWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return workflows.filter((workflow) => {
      if (filter !== 'all' && workflow.category !== filter) return false;
      if (!normalizedQuery) return true;
      return `${workflow.name} ${workflow.description} ${workflow.categoryLabel}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedQuery);
    });
  }, [filter, query, workflows]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeletingId(deleteTarget.id);
      setError(null);
      await deleteEcommerceWorkflow(deleteTarget.id);
      setWorkflows((current) => current.filter((workflow) => workflow.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除工作流失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="vela-commerce" aria-labelledby="vela-commerce-title">
      <header className="vela-commerce-heading">
        <h1 id="vela-commerce-title"><ShoppingBag size={19} aria-hidden="true" />电商工作流</h1>
        <span className="vela-commerce-count">{workflows.length} 个工作流</span>
      </header>

      <div className="vela-commerce-toolbar">
        <div className="vela-commerce-filters" role="group" aria-label="筛选电商工作流">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              data-active={filter === item.id || undefined}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="vela-commerce-search">
          <Search size={17} aria-hidden="true" />
          <span className="vela-visually-hidden">搜索工作流</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作流" />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} aria-hidden="true" /></button>
          )}
        </label>
      </div>

      {error && (
        <div className="vela-commerce-message" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>重新加载</button>
        </div>
      )}

      {loading ? (
        <div className="vela-commerce-grid" aria-label="正在加载工作流">
          {Array.from({ length: 8 }, (_, index) => <div className="vela-commerce-skeleton" key={index} aria-hidden="true" />)}
        </div>
      ) : visibleWorkflows.length > 0 ? (
        <div className="vela-commerce-grid" aria-live="polite">
          {visibleWorkflows.map((workflow) => {
            const isCreating = busyWorkflowId === workflow.id;
            return (
              <article className="vela-commerce-card" key={workflow.id}>
                <button
                  type="button"
                  className="vela-commerce-card__delete"
                  aria-label={`删除工作流：${workflow.name}`}
                  disabled={disabled || Boolean(deletingId)}
                  onClick={() => setDeleteTarget(workflow)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="vela-commerce-card__action"
                  disabled={disabled}
                  aria-describedby={`vela-commerce-description-${workflow.id}`}
                  onClick={() => void onCreate(workflow.id)}
                >
                  <span className="vela-commerce-card__preview-wrap">
                    <WorkflowCanvasPreview name={workflow.name} preview={workflow.preview} />
                    <span className="vela-commerce-card__open">
                      {isCreating ? <Loader2 className="vela-spin" size={16} aria-hidden="true" /> : <ArrowUpRight size={16} aria-hidden="true" />}
                      {isCreating ? '正在创建' : '打开画布'}
                    </span>
                  </span>
                  <span className="vela-commerce-card__copy">
                    <span className="vela-commerce-card__meta"><Workflow size={14} aria-hidden="true" />{workflow.categoryLabel}<i aria-hidden="true" />{workflow.inputCount} 个输入 · {workflow.engineLabel}</span>
                    <strong>{workflow.name}</strong>
                    <span id={`vela-commerce-description-${workflow.id}`}>{workflow.description}</span>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="vela-commerce-empty">
          <Workflow size={28} aria-hidden="true" />
          <strong>{workflows.length === 0 ? '工作流已全部删除' : '没有匹配的工作流'}</strong>
          <span>{workflows.length === 0 ? '已创建的项目不会受到影响。' : '请更换分类或搜索关键词。'}</span>
          {query && <button type="button" onClick={() => { setQuery(''); setFilter('all'); }}>查看全部</button>}
        </div>
      )}

      {deleteTarget && (
        <div className="vela-home-dialog-backdrop" role="presentation" onMouseDown={() => !deletingId && setDeleteTarget(null)}>
          <section className="vela-home-dialog" role="alertdialog" aria-modal="true" aria-labelledby="vela-workflow-delete-title" aria-describedby="vela-workflow-delete-description" onMouseDown={(event) => event.stopPropagation()}>
            <span className="vela-home-delete-icon"><Trash2 size={21} aria-hidden="true" /></span>
            <h2 id="vela-workflow-delete-title">删除“{deleteTarget.name}”？</h2>
            <p id="vela-workflow-delete-description">它会从电商工作流板块移除，但不会删除下载目录里的原始 JSON，也不会影响已创建的项目。</p>
            <div className="vela-home-dialog-actions">
              <button ref={cancelDeleteRef} type="button" disabled={Boolean(deletingId)} onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" data-danger="true" disabled={Boolean(deletingId)} onClick={() => void confirmDelete()}>
                {deletingId ? '正在删除…' : '删除工作流'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
