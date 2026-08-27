import { ArrowUpRight, Clapperboard, FolderKanban, ImageIcon } from 'lucide-react';
import { useState } from 'react';

import type { VelaProjectSummary } from '../services/projectService';

export function ProjectThumbnail({ project, compact = false }: { project: VelaProjectSummary; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!project.thumbnailUrl || failed) {
    return (
      <span className="vela-home-project-placeholder" data-compact={compact || undefined} aria-hidden="true">
        <ImageIcon size={compact ? 18 : 28} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      className="vela-home-project-thumbnail"
      data-compact={compact || undefined}
      src={project.thumbnailUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

const formatUpdatedAt = (value: string) => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '最近更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
};

interface VelaProjectGalleryProps {
  projects: VelaProjectSummary[];
  variant: 'project' | 'storyworks';
  currentProjectId?: string;
  disabled?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (projectId: string) => void | Promise<void>;
}

export function VelaProjectGallery({
  projects,
  variant,
  currentProjectId,
  disabled,
  emptyTitle,
  emptyDescription,
  onOpen
}: VelaProjectGalleryProps) {
  if (projects.length === 0) {
    const EmptyIcon = variant === 'storyworks' ? Clapperboard : FolderKanban;
    return (
      <div className="vela-project-gallery-empty" role="status">
        <EmptyIcon size={29} strokeWidth={1.6} aria-hidden="true" />
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
    );
  }

  return (
    <div className="vela-project-gallery" aria-live="polite">
      {projects.map((project) => (
        <article
          className="vela-project-gallery-card"
          data-current={project.id === currentProjectId || undefined}
          data-variant={variant}
          key={project.id}
        >
          <button type="button" disabled={disabled} onClick={() => void onOpen(project.id)}>
            <span className="vela-project-gallery-card__preview">
              <ProjectThumbnail project={project} />
              <span className="vela-project-gallery-card__badge">
                {variant === 'storyworks' ? <Clapperboard size={13} aria-hidden="true" /> : <FolderKanban size={13} aria-hidden="true" />}
                {variant === 'storyworks' ? '短剧' : '项目'}
              </span>
              <span className="vela-project-gallery-card__open"><ArrowUpRight size={15} aria-hidden="true" />打开画布</span>
            </span>
            <span className="vela-project-gallery-card__copy">
              <strong>{project.name}</strong>
              <small>{project.nodeCount} 个节点 · {formatUpdatedAt(project.updatedAt)} 更新</small>
            </span>
          </button>
        </article>
      ))}
    </div>
  );
}
