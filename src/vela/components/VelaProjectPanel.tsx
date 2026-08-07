import { FolderOpen, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { listVelaProjects, type VelaProjectSummary } from '../services/projectService';

interface VelaProjectPanelProps {
  isOpen: boolean;
  currentProjectId?: string;
  onClose: () => void;
  onLoad: (projectId: string) => void;
}

export function VelaProjectPanel({ isOpen, currentProjectId, onClose, onLoad }: VelaProjectPanelProps) {
  const [projects, setProjects] = useState<VelaProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listVelaProjects()
      .then((items) => { setProjects(items); setError(null); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取项目'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <aside className="vela-project-panel vela-panel" aria-label="本地项目">
      <header>
        <div><FolderOpen size={17} aria-hidden="true" /><strong>本地项目</strong></div>
        <button type="button" className="vela-button vela-icon-button" onClick={onClose} aria-label="关闭项目面板">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="vela-project-list">
        {loading ? <div className="vela-project-empty"><Loader2 className="animate-spin" />正在读取项目…</div>
          : error ? <div className="vela-project-empty" role="alert">{error}</div>
            : projects.length === 0 ? <div className="vela-project-empty">还没有本地项目，点击右上角“保存”创建。</div>
              : projects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  className="vela-project-card vela-focusable"
                  data-current={project.id === currentProjectId || undefined}
                  onClick={() => onLoad(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{project.nodeCount} 个节点 · {new Date(project.updatedAt).toLocaleString('zh-CN')}</span>
                </button>
              ))}
      </div>
    </aside>
  );
}
