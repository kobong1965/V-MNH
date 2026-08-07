import React, { useState } from 'react';
import {
  AlignHorizontalSpaceAround,
  CircleHelp,
  Cloud,
  FolderOpen,
  GitBranch,
  Images,
  Keyboard,
  ListChecks,
  MousePointer2,
  Plus,
  X
} from 'lucide-react';

interface VelaNodeRailProps {
  onAddClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onProjectsClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAssetsClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onTasksClick: () => void;
  onComputeClick: () => void;
  onArrangeClick: () => void;
}

export function VelaNodeRail({
  onAddClick,
  onProjectsClick,
  onAssetsClick,
  onTasksClick,
  onComputeClick,
  onArrangeClick
}: VelaNodeRailProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <>
      <button className="vela-assets-shortcut vela-focusable" type="button" onClick={onAssetsClick}>
        <Images size={16} aria-hidden="true" />
        <span>资产管理</span>
      </button>

      <nav className="vela-node-rail" aria-label="画布工具">
        <RailButton label="添加节点" icon={<Plus size={21} />} primary onClick={onAddClick} />
        <RailButton label="选择" icon={<MousePointer2 size={18} />} />
        <RailButton label="项目" icon={<FolderOpen size={18} />} onClick={onProjectsClick} />
        <RailButton label="连线" icon={<GitBranch size={18} />} />
        <RailButton label="素材" icon={<Images size={18} />} onClick={onAssetsClick} />
        <RailButton label="整理画布" icon={<AlignHorizontalSpaceAround size={18} />} onClick={onArrangeClick} />
        <RailButton label="算力" icon={<Cloud size={18} />} onClick={onComputeClick} />
        <RailButton label="任务" icon={<ListChecks size={18} />} onClick={onTasksClick} />
        <RailButton label="快捷键" icon={<Keyboard size={18} />} onClick={() => setShowShortcuts(true)} />
        <RailButton label="帮助" icon={<CircleHelp size={18} />} />
      </nav>

      {showShortcuts && (
        <div className="vela-modal-backdrop" role="presentation" onMouseDown={() => setShowShortcuts(false)}>
          <section className="vela-shortcuts-modal" role="dialog" aria-modal="true" aria-label="快捷键" onMouseDown={(event) => event.stopPropagation()}>
            <button className="vela-modal-close" type="button" onClick={() => setShowShortcuts(false)} aria-label="关闭"><X size={20} /></button>
            <ShortcutColumn title="创作" items={[['添加节点', 'Tab'], ['生成', 'Ctrl + Enter'], ['复制节点', 'Ctrl + D'], ['删除', 'Delete']]} />
            <ShortcutColumn title="缩放" items={[['放大', 'Ctrl + +'], ['缩小', 'Ctrl + -'], ['适应画布', 'Ctrl + 0']]} />
            <ShortcutColumn title="移动画布" items={[['抓手工具', 'H'], ['移动工具', 'V'], ['画布平移', 'Space + 拖动']]} />
            <ShortcutColumn title="其他" items={[['撤销', 'Ctrl + Z'], ['重做', 'Ctrl + Shift + Z'], ['保存', 'Ctrl + S']]} />
          </section>
        </div>
      )}
    </>
  );
}

interface RailButtonProps {
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

function RailButton({ label, icon, primary = false, onClick }: RailButtonProps) {
  return (
    <button
      className="vela-rail-button vela-focusable"
      data-primary={primary || undefined}
      aria-label={label}
      title={label}
      type="button"
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

function ShortcutColumn({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="vela-shortcut-column">
      <h3>{title}</h3>
      {items.map(([label, keys]) => (
        <div className="vela-shortcut-row" key={label}>
          <span>{label}</span>
          <kbd>{keys}</kbd>
        </div>
      ))}
    </div>
  );
}
