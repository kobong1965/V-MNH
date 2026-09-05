import { ChevronDown, ChevronUp, Crosshair, ListChecks, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getVelaJobErrorMessage, type VelaJob, type VelaJobStatus } from '../services/jobService';
import type { VelaProfile } from '../services/profileService';

interface VelaTaskCenterProps {
  isOpen: boolean;
  jobs: VelaJob[];
  profiles: VelaProfile[];
  error?: string | null;
  projectId?: string | null;
  onToggle: () => void;
  onRetry: (jobId: string) => void | Promise<void>;
  onCancel: (jobId: string) => void | Promise<void>;
  onFocusNode?: (nodeId: string) => void;
}

const STATUS_TEXT: Record<VelaJobStatus, string> = {
  queued: '等待算力',
  preparing: '准备素材',
  submitting: '正在提交',
  running: '生成中',
  reconnecting: '正在恢复',
  downloading: '下载中',
  succeeded: '已完成',
  failed: '失败',
  submission_uncertain: '失败',
  cancelled: '已取消'
};

const RUNNING = new Set<VelaJobStatus>(['preparing', 'submitting', 'running', 'reconnecting', 'downloading']);

export function VelaTaskCenter({
  isOpen,
  jobs,
  profiles,
  error,
  projectId,
  onToggle,
  onRetry,
  onCancel,
  onFocusNode
}: VelaTaskCenterProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'failed'>('all');
  const projectJobs = useMemo(() => projectId ? jobs.filter((job) => job.projectId === projectId) : jobs, [jobs, projectId]);
  const visibleJobs = useMemo(() => projectJobs.filter((job) => (
    filter === 'active' ? RUNNING.has(job.status) || job.status === 'queued'
      : filter === 'failed' ? ['failed', 'submission_uncertain'].includes(job.status)
        : true
  )), [filter, projectJobs]);
  const runningCount = projectJobs.filter((job) => RUNNING.has(job.status) || job.status === 'queued').length;
  const failedCount = projectJobs.filter((job) => ['failed', 'submission_uncertain'].includes(job.status)).length;
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
  if (!isOpen) return null;

  return (
    <section className="vela-task-center vela-panel" data-open={isOpen} aria-label="任务中心">
      <button className="vela-task-summary vela-focusable" onClick={onToggle} aria-expanded={isOpen}>
        <span className="vela-task-summary-title">
          <ListChecks size={16} aria-hidden="true" />
          任务中心
        </span>
        <span className="vela-task-counts vela-utility-text">
          当前项目 · 运行 {runningCount} · 失败 {failedCount} · 共 {projectJobs.length}
        </span>
        {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      {isOpen && (
        <div className="vela-task-body">
          <div className="vela-task-filters" role="tablist" aria-label="任务筛选">
            {([['all', `全部 ${projectJobs.length}`], ['active', `进行中 ${runningCount}`], ['failed', `失败 ${failedCount}`]] as const).map(([value, label]) => (
              <button type="button" role="tab" aria-selected={filter === value} data-active={filter === value || undefined} onClick={() => setFilter(value)} key={value}>{label}</button>
            ))}
          </div>
          <div className="vela-task-list" role="list">
          {error && <div className="vela-task-error" role="status">{error}</div>}
          {visibleJobs.length === 0 ? (
            <div className="vela-task-empty" role="status">
              当前筛选没有任务。GPT 图片或 H3 视频任务会按项目保存在本地数据库。
            </div>
          ) : visibleJobs.map((job) => (
            <article
              className="vela-task-item"
              data-running={RUNNING.has(job.status) || undefined}
              key={job.id}
              role="listitem"
            >
              <span className="vela-task-state" data-status={job.status}>{STATUS_TEXT[job.status]}</span>
              <div className="vela-task-copy">
                <strong>{String(job.payload.prompt || job.providerType)}</strong>
                <span>{profileNames.get(job.profileId) || job.profileId} · Seed {job.seed} · 重试 {job.retryCount}</span>
                {['failed', 'submission_uncertain'].includes(job.status) && (
                  <span className="vela-task-reason" title={job.error?.message || undefined}>
                    {getVelaJobErrorMessage(job.error)}
                  </span>
                )}
              </div>
              <span className="vela-task-output vela-utility-text">
                {job.progress === null ? '—' : `${Math.round(job.progress * 100)}%`}
              </span>
              <button className="vela-button vela-icon-button" onClick={() => onFocusNode?.(job.nodeId)} aria-label="定位画布节点" title="定位画布节点">
                <Crosshair size={15} aria-hidden="true" />
              </button>
              {['failed', 'submission_uncertain', 'cancelled'].includes(job.status) ? (
                <button className="vela-button vela-icon-button" onClick={() => void onRetry(job.id)} aria-label="重试任务" title="重试任务">
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="vela-button vela-icon-button"
                  onClick={() => void onCancel(job.id)}
                  aria-label="取消任务"
                  title="取消任务"
                  disabled={!['queued', 'running', 'reconnecting'].includes(job.status)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </article>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}
