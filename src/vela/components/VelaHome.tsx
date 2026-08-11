import {
  Clock3,
  Download,
  FolderKanban,
  Home,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  Plus,
  Settings,
  Sparkles,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import appIcon from '../../../build/icon.png';
import {
  deleteVelaProject,
  exportVelaProjectPackage,
  importVelaProjectPackage,
  listVelaProjects,
  renameVelaProject,
  type VelaProjectSummary
} from '../services/projectService';
import type { VelaProfile } from '../services/profileService';
import type { AppearanceMode, CanvasColorMode } from '../services/settingsService';
import { VelaApiSettings } from './VelaApiSettings';
import { VelaSettings } from './VelaSettings';
import './VelaHome.css';

interface VelaHomeProps {
  page: 'home' | 'api' | 'settings';
  theme: 'light' | 'dark';
  currentProjectId?: string;
  onCreate: () => Promise<void>;
  onOpen: (projectId: string) => Promise<void>;
  onProjectDeleted: (projectId: string) => void;
  onNavigate: (page: 'home' | 'api' | 'settings') => void;
  profiles: VelaProfile[];
  profilesError?: string | null;
  onProfilesChanged: () => void | Promise<unknown>;
  appearance: AppearanceMode;
  canvas: CanvasColorMode;
  onAppearanceChange: (value: AppearanceMode) => void;
  onCanvasChange: (value: CanvasColorMode) => void;
}

const formatUpdatedAt = (value: string) => {
  const updatedAt = new Date(value);
  const elapsed = Date.now() - updatedAt.getTime();
  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  return updatedAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
};

function ProjectThumbnail({ project, compact = false }: { project: VelaProjectSummary; compact?: boolean }) {
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

export function VelaHome({
  page,
  theme,
  currentProjectId,
  onCreate,
  onOpen,
  onProjectDeleted,
  onNavigate,
  profiles,
  profilesError,
  onProfilesChanged,
  appearance,
  canvas,
  onAppearanceChange,
  onCanvasChange
}: VelaHomeProps) {
  const [projects, setProjects] = useState<VelaProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<VelaProjectSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VelaProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const packageInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setProjects(await listVelaProjects());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取本地项目');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!renameTarget) return;
    setRenameValue(renameTarget.name);
    window.setTimeout(() => renameInputRef.current?.select(), 0);
  }, [renameTarget]);
  useEffect(() => {
    const closeMenu = () => setMenuKey(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const runCreate = async () => {
    try {
      setBusy(true);
      setError(null);
      await onCreate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新建项目失败');
    } finally {
      setBusy(false);
    }
  };

  const runOpen = async (projectId: string) => {
    try {
      setBusy(true);
      setError(null);
      await onOpen(projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '打开项目失败');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    try {
      setBusy(true);
      await renameVelaProject(renameTarget.id, renameValue.trim());
      setRenameTarget(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setBusy(true);
      await deleteVelaProject(deleteTarget.id);
      onProjectDeleted(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除项目失败');
    } finally {
      setBusy(false);
    }
  };

  const shareProject = async (project: VelaProjectSummary) => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      setMenuKey(null);
      await exportVelaProjectPackage(project.id, project.name);
      setNotice(`“${project.name}”分享包已下载。分享包不包含 API Key。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分享包导出失败');
    } finally {
      setBusy(false);
    }
  };

  const importPackage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const imported = await importVelaProjectPackage(file);
      await refresh();
      await onOpen(imported.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分享包导入失败');
    } finally {
      setBusy(false);
    }
  };

  const openProjectMenu = (event: React.MouseEvent, key: string) => {
    event.stopPropagation();
    setMenuKey((current) => current === key ? null : key);
  };

  const recentProjects = projects.slice(0, 6);

  return (
    <div className="vela-home-shell" data-theme={theme}>
      <aside className="vela-home-sidebar" aria-label="主导航">
        <header className="vela-home-brand">
          <img src={appIcon} alt="" />
          <strong>V-MNH</strong>
        </header>

        <button className="vela-home-create" type="button" onClick={() => void runCreate()} disabled={busy}>
          {busy ? <Loader2 className="vela-spin" size={19} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
          <span>新建项目</span>
        </button>

        <input
          ref={packageInputRef}
          className="vela-home-file-input"
          type="file"
          accept=".vela,application/vnd.vela.project"
          onChange={(event) => void importPackage(event)}
        />
        <button
          className="vela-home-import"
          type="button"
          onClick={() => packageInputRef.current?.click()}
          disabled={busy}
        >
          <PackageOpen size={18} aria-hidden="true" />
          <span>导入分享包</span>
        </button>

        <nav className="vela-home-nav" aria-label="项目导航">
          <button type="button" data-active={page === 'home' || undefined} onClick={() => onNavigate('home')}><Home size={18} aria-hidden="true" />首页</button>
        </nav>

        <section className="vela-home-recent-list" aria-labelledby="vela-recent-sidebar-title">
          <h2 id="vela-recent-sidebar-title">最近项目</h2>
          {recentProjects.map((project) => (
            <div className="vela-home-sidebar-project" data-current={project.id === currentProjectId || undefined} key={project.id}>
              <button type="button" className="vela-home-sidebar-open" onClick={() => void runOpen(project.id)}>
                <ProjectThumbnail project={project} compact />
                <span>{project.name}</span>
              </button>
              <button
                type="button"
                className="vela-home-menu-trigger"
                aria-label={`${project.name} 项目菜单`}
                aria-expanded={menuKey === `sidebar:${project.id}`}
                onClick={(event) => openProjectMenu(event, `sidebar:${project.id}`)}
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
              {menuKey === `sidebar:${project.id}` && (
                <ProjectMenu
                  project={project}
                  onOpen={() => void runOpen(project.id)}
                  onExport={() => void shareProject(project)}
                  onRename={() => { setRenameTarget(project); setMenuKey(null); }}
                  onDelete={() => { setDeleteTarget(project); setMenuKey(null); }}
                />
              )}
            </div>
          ))}
        </section>

        <nav className="vela-home-footer-nav" aria-label="应用设置">
          <button type="button" data-active={page === 'api' || undefined} onClick={() => onNavigate('api')}><Sparkles size={18} aria-hidden="true" /><span>API</span></button>
          <button type="button" data-active={page === 'settings' || undefined} onClick={() => onNavigate('settings')}><Settings size={18} aria-hidden="true" /><span>设置</span></button>
        </nav>
      </aside>

      {page === 'home' ? <main className="vela-home-main">
        <header className="vela-home-heading">
          <div>
            <span className="vela-home-eyebrow">V-MNH 创作工作台</span>
            <h1>首页</h1>
            <p>从一个新项目开始，每个项目都拥有独立的画布与生成记录。</p>
          </div>
        </header>

        {error && <div className="vela-home-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
        {notice && <div className="vela-home-notice" role="status">{notice}</div>}

        <section className="vela-home-projects" aria-labelledby="vela-recent-title">
          <div className="vela-home-section-title">
            <div><Clock3 size={18} aria-hidden="true" /><h2 id="vela-recent-title">最近项目</h2></div>
            <span>{projects.length} 个本地项目</span>
          </div>

          {loading ? (
            <div className="vela-home-loading" role="status"><Loader2 className="vela-spin" size={24} />正在读取项目…</div>
          ) : projects.length === 0 ? (
            <div className="vela-home-empty">
              <FolderKanban size={36} strokeWidth={1.4} aria-hidden="true" />
              <h2>还没有项目</h2>
              <p>新建第一个项目，进入一张干净的无限画布。</p>
              <button type="button" onClick={() => void runCreate()}><Plus size={18} />新建项目</button>
            </div>
          ) : (
            <div className="vela-home-project-grid">
              {projects.map((project) => (
                <article className="vela-home-project-tile" data-current={project.id === currentProjectId || undefined} key={project.id}>
                  <button className="vela-home-project-open" type="button" onClick={() => void runOpen(project.id)}>
                    <ProjectThumbnail project={project} />
                    <span className="vela-home-project-copy">
                      <strong>{project.name}</strong>
                      <small>{project.nodeCount} 个节点 · {formatUpdatedAt(project.updatedAt)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="vela-home-tile-menu-trigger"
                    aria-label={`${project.name} 项目菜单`}
                    aria-expanded={menuKey === `tile:${project.id}`}
                    onClick={(event) => openProjectMenu(event, `tile:${project.id}`)}
                  >
                    <MoreHorizontal size={19} aria-hidden="true" />
                  </button>
                  {menuKey === `tile:${project.id}` && (
                    <ProjectMenu
                      project={project}
                      onOpen={() => void runOpen(project.id)}
                      onExport={() => void shareProject(project)}
                      onRename={() => { setRenameTarget(project); setMenuKey(null); }}
                      onDelete={() => { setDeleteTarget(project); setMenuKey(null); }}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main> : page === 'api' ? (
        <main className="vela-home-main vela-home-main--settings">
          <VelaApiSettings profiles={profiles} profilesError={profilesError} onProfilesChanged={onProfilesChanged} />
        </main>
      ) : (
        <main className="vela-home-main vela-home-main--settings">
          <VelaSettings
            appearance={appearance}
            canvas={canvas}
            resolvedAppearance={theme}
            onAppearanceChange={onAppearanceChange}
            onCanvasChange={onCanvasChange}
          />
        </main>
      )}

      {renameTarget && (
        <div className="vela-home-dialog-backdrop" role="presentation" onMouseDown={() => setRenameTarget(null)}>
          <form className="vela-home-dialog" role="dialog" aria-modal="true" aria-labelledby="vela-rename-title" onSubmit={submitRename} onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="vela-rename-title">重命名项目</h2>
            <label htmlFor="vela-project-name">项目名称</label>
            <input ref={renameInputRef} id="vela-project-name" value={renameValue} maxLength={120} onChange={(event) => setRenameValue(event.target.value)} />
            <div className="vela-home-dialog-actions">
              <button type="button" onClick={() => setRenameTarget(null)}>取消</button>
              <button type="submit" data-primary="true" disabled={!renameValue.trim() || busy}>保存</button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="vela-home-dialog-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
          <section className="vela-home-dialog" role="alertdialog" aria-modal="true" aria-labelledby="vela-delete-title" aria-describedby="vela-delete-description" onMouseDown={(event) => event.stopPropagation()}>
            <span className="vela-home-delete-icon"><Trash2 size={21} aria-hidden="true" /></span>
            <h2 id="vela-delete-title">删除“{deleteTarget.name}”？</h2>
            <p id="vela-delete-description">该项目的画布、节点和本地素材将被删除，此操作无法撤销。</p>
            <div className="vela-home-dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" data-danger="true" disabled={busy} onClick={() => void confirmDelete()}>删除项目</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProjectMenu({
  project,
  onOpen,
  onExport,
  onRename,
  onDelete
}: {
  project: VelaProjectSummary;
  onOpen: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="vela-home-project-menu" role="menu" aria-label={`${project.name} 项目操作`} onClick={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={onOpen}>打开</button>
      <button type="button" role="menuitem" onClick={onExport}><Download size={15} aria-hidden="true" />分享打包</button>
      <button type="button" role="menuitem" onClick={onRename}>重命名</button>
      <button type="button" role="menuitem" data-danger="true" onClick={onDelete}>删除项目</button>
    </div>
  );
}
