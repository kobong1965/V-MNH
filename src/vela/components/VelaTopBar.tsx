import React, { useState } from 'react';
import { ChevronDown, Cloud, LayoutGrid, ListChecks, Plus, Save, Sparkles } from 'lucide-react';

interface VelaTopBarProps {
  canvasTitle: string;
  isEditingTitle: boolean;
  editingTitleValue: string;
  canvasTitleInputRef: React.RefObject<HTMLInputElement>;
  setCanvasTitle: (title: string) => void;
  setIsEditingTitle: (editing: boolean) => void;
  setEditingTitleValue: (value: string) => void;
  onSave: () => void | Promise<void>;
  onNew: () => void;
  onOpenTasks: () => void;
  onOpenCompute: () => void;
  hasUnsavedChanges: boolean;
  lastAutoSaveTime?: number;
  activeTaskCount: number;
  onlineComputeCount: number;
}

export function VelaTopBar({
  canvasTitle,
  isEditingTitle,
  editingTitleValue,
  canvasTitleInputRef,
  setCanvasTitle,
  setIsEditingTitle,
  setEditingTitleValue,
  onSave,
  onNew,
  onOpenTasks,
  onOpenCompute,
  hasUnsavedChanges,
  lastAutoSaveTime,
  activeTaskCount,
  onlineComputeCount
}: VelaTopBarProps) {
  const [isSaving, setIsSaving] = useState(false);

  const finishTitleEdit = () => {
    const title = editingTitleValue.trim();
    if (title) setCanvasTitle(title);
    else setEditingTitleValue(canvasTitle);
    setIsEditingTitle(false);
  };

  const saveProject = async () => {
    try {
      setIsSaving(true);
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const saveLabel = hasUnsavedChanges
    ? '有未保存修改'
    : lastAutoSaveTime
      ? `已保存 ${new Date(lastAutoSaveTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : '本地保存';

  return (
    <header className="vela-topbar" aria-label="项目工具栏">
      <div className="vela-workspace-pill">
        <button className="vela-brand-button vela-focusable" type="button" aria-label="Vela 工作区">
          <span className="vela-brand-mark" aria-hidden="true">V</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        <span className="vela-topbar-divider" aria-hidden="true" />
        <div className="vela-project-title">
          {isEditingTitle ? (
            <input
              ref={canvasTitleInputRef}
              className="vela-project-title-input"
              value={editingTitleValue}
              aria-label="项目名称"
              onBlur={finishTitleEdit}
              onChange={(event) => setEditingTitleValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') finishTitleEdit();
                if (event.key === 'Escape') {
                  setEditingTitleValue(canvasTitle);
                  setIsEditingTitle(false);
                }
              }}
            />
          ) : (
            <button
              className="vela-title-button vela-focusable"
              type="button"
              onClick={() => {
                setEditingTitleValue(canvasTitle);
                setIsEditingTitle(true);
              }}
              title={`${saveLabel}，点击修改名称`}
            >
              {canvasTitle || '未命名工作区'}
              {hasUnsavedChanges && <span className="vela-unsaved-dot" aria-label="未保存" />}
            </button>
          )}
        </div>
        <span className="vela-topbar-divider" aria-hidden="true" />
        <button className="vela-canvas-switch vela-focusable" type="button">
          <LayoutGrid size={14} aria-hidden="true" />
          <span>画布 1</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>

      <nav className="vela-topbar-actions" aria-label="项目操作">
        <button className="vela-top-action vela-icon-only" type="button" onClick={onNew} aria-label="新建项目" title="新建项目">
          <Plus size={17} aria-hidden="true" />
        </button>
        <button className="vela-top-action" type="button" onClick={onOpenCompute}>
          <Cloud size={16} aria-hidden="true" />
          <span>算力</span>
          <span className="vela-status-number" data-online={onlineComputeCount > 0 || undefined}>{onlineComputeCount}</span>
        </button>
        <button className="vela-top-action" type="button" onClick={onOpenTasks}>
          <ListChecks size={16} aria-hidden="true" />
          <span>任务</span>
          <span className="vela-status-number" data-active={activeTaskCount > 0 || undefined}>{activeTaskCount}</span>
        </button>
        <button className="vela-top-action vela-save-button" type="button" disabled={isSaving} onClick={saveProject} title={saveLabel}>
          {isSaving ? <Sparkles size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          <span>{isSaving ? '保存中' : '保存'}</span>
        </button>
      </nav>
    </header>
  );
}
