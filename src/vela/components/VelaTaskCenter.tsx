import { ChevronDown, ChevronUp, ListChecks, RotateCcw, X } from 'lucide-react';

import type { VelaJob, VelaJobStatus } from '../services/jobService';

interface VelaTaskCenterProps {
  isOpen: boolean;
  jobs: VelaJob[];
  error?: string | null;
  onToggle: () => void;
  onRetry: (jobId: string) => void | Promise<void>;
  onCancel: (jobId: string) => void | Promise<void>;
}

const STATUS_TEXT: Record<VelaJobStatus, string> = {
  queued: '等待算力',
  submitting: '正在提交',
  running: '生成中',
  reconnecting: '正在恢复',
  downloading: '下载中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const RUNNING = new Set<VelaJobStatus>(['submitting', 'running', 'reconnecting', 'downloading']);

export function VelaTaskCenter({
  isOpen,
  jobs,
  error,
  onToggle,
  onRetry,
  onCancel
}: VelaTaskCenterProps) {
  if (!isOpen) return null;
  const runningCount = jobs.filter((job) => RUNNING.has(job.status)).length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;

  return (
    <section className="vela-task-center vela-panel" data-open={isOpen} aria-label="任务中心">
      <button className="vela-task-summary vela-focusable" onClick={onToggle} aria-expanded={isOpen}>
        <span className="vela-task-summary-title">
          <ListChecks size={16} aria-hidden="true" />
          任务中心
        </span>
        <span className="vela-task-counts vela-utility-text">
          运行 {runningCount} · 失败 {failedCount} · 共 {jobs.length}
        </span>
        {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      {isOpen && (
        <div className="vela-task-list" role="list">
          {error && <div className="vela-task-error" role="status">{error}</div>}
          {jobs.length === 0 ? (
            <div className="vela-task-empty" role="status">
              还没有持久化任务。从 GPT 图片或 H3 视频节点开始生成后，任务会保存在本地数据库。
            </div>
          ) : jobs.map((job) => (
            <article
              className="vela-task-item"
              data-running={RUNNING.has(job.status) || undefined}
              key={job.id}
              role="listitem"
            >
              <span className="vela-task-state" data-status={job.status}>{STATUS_TEXT[job.status]}</span>
              <div className="vela-task-copy">
                <strong>{String(job.payload.prompt || job.providerType)}</strong>
                <span>{job.profileId} · Seed {job.seed} · 重试 {job.retryCount}</span>
              </div>
              <span className="vela-task-output vela-utility-text">
                {job.progress === null ? '—' : `${Math.round(job.progress * 100)}%`}
              </span>
              {job.status === 'failed' || job.status === 'cancelled' ? (
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
      )}
    </section>
  );
}
