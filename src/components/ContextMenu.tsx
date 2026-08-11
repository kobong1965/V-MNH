import React, { useEffect, useRef, useState } from 'react';
import {
  Type,
  Image as ImageIcon,
  Video,
  Film,
  Upload,
  Trash2,
  Plus,
  Undo2,
  Redo2,
  Clipboard,
  Copy,
  Files,
  Layers,
  ChevronRight,
  WandSparkles
} from 'lucide-react';
import { ContextMenuState, NodeType } from '../types';
import { canConnectNodeKinds, VELA_NODE_CATALOG, type VelaNodeKind } from '../vela/nodeCatalog';

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSelectType: (type: NodeType | 'DELETE') => void;
  onSelectNodeKind: (kind: VelaNodeKind) => void;
  onUpload: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onCreateAsset?: () => void;
  onAddAssets?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canvasTheme?: 'dark' | 'light';
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  onClose,
  onSelectType,
  onSelectNodeKind,
  onUpload,
  onUndo,
  onRedo,
  onPaste,
  onCopy,
  onDuplicate,
  onCreateAsset,
  onAddAssets,
  canUndo = false,
  canRedo = false,
  canvasTheme = 'dark'
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'main' | 'add-nodes'>('main');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Reset view when menu opens or re-opens (new state)
  useEffect(() => {
    if (state.isOpen && state.type === 'global') {
      setView('main');
    }
  }, [state]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      onClose();
    }
    // Reset value so same file can be selected again
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleUndo = () => {
    if (onUndo && canUndo) {
      onUndo();
      onClose();
    }
  };

  const handleRedo = () => {
    if (onRedo && canRedo) {
      onRedo();
      onClose();
    }
  };

  const handlePaste = () => {
    if (onPaste) {
      onPaste();
      onClose();
    }
  };


  if (!state.isOpen) return null;

  // 1. Right Click on Node
  if (state.type === 'node-options') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'absolute', left: state.x, top: state.y, zIndex: 1000 }}
        className={`w-48 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'
          }`}
      >
        <div className="p-1.5 flex flex-col gap-0.5">
          <MenuItem
            icon={<ImageIcon size={16} />}
            label="保存到素材库"
            onClick={() => {
              if (onCreateAsset) {
                onCreateAsset();
                onClose();
              }
            }}
            active={false}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Copy size={16} />}
            label="复制"
            shortcut="Ctrl+C"
            onClick={() => {
              if (onCopy) {
                onCopy();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Clipboard size={16} />}
            label="粘贴"
            shortcut="Ctrl+V"
            onClick={handlePaste}
            disabled={true} // Disabled in screenshot
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Files size={16} />}
            label="创建副本"
            onClick={() => {
              if (onDuplicate) {
                onDuplicate();
                onClose();
              }
            }}
          />

          <div className="my-1 border-t border-neutral-800 mx-1" />

          <MenuItem
            icon={<Trash2 size={16} />} // Screenshot has text "Delete", icon might be different
            label="删除"
            shortcut="Delete"
            onClick={() => onSelectType('DELETE')}
            canvasTheme={canvasTheme}
          />
        </div>
      </div>
    );
  }

  // 2. Connector Drag Drop (Add Next)
  const isConnector = state.type === 'node-connector';
  const visibleNodeDefinitions = isConnector && state.sourceNodeKind
    ? VELA_NODE_CATALOG.filter((definition) => state.connectorSide === 'left'
      ? canConnectNodeKinds(definition.kind, state.sourceNodeKind!)
      : canConnectNodeKinds(state.sourceNodeKind!, definition.kind))
    : VELA_NODE_CATALOG;

  // If it's the Global Menu (Right Click on Blank), we show the specific options
  if (state.type === 'global' && view === 'main') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'absolute', left: state.x, top: state.y, zIndex: 1000 }}
        className={`w-64 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'
          }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
        <div className="p-1.5 flex flex-col gap-0.5">
          <MenuItem
            icon={<Upload size={16} />}
            label="导入图片或视频"
            onClick={handleUploadClick}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Layers size={16} />}
            label="从素材库添加"
            onClick={() => {
              if (onAddAssets) {
                onAddAssets();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Plus size={16} />}
            label="添加节点"
            rightSlot={<ChevronRight size={14} className={canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'} />}
            onClick={() => setView('add-nodes')}
            active={false}
            canvasTheme={canvasTheme}
          />

          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Undo2 size={16} />}
            label="撤销"
            shortcut="Ctrl+Z"
            onClick={handleUndo}
            disabled={!canUndo}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Redo2 size={16} />}
            label="重做"
            shortcut="Ctrl+Shift+Z"
            onClick={handleRedo}
            disabled={!canRedo}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Clipboard size={16} />}
            label="粘贴"
            shortcut="Ctrl+V"
            onClick={handlePaste}
            canvasTheme={canvasTheme}
          />
        </div>
      </div >
    );
  }

  // 3. Add Nodes Menu (Global Submenu OR Connector Default)
  const title = isConnector ? "从此节点继续" : "添加节点";

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        left: state.x,
        top: state.y,
        zIndex: 1000
      }}
      className={`vela-add-menu w-56 border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'
        }`}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*"
        onChange={handleFileChange}
      />
      <div className={`px-4 pt-4 pb-2 text-sm font-medium ${canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'
        }`}>
        {title}
      </div>

      <div className="px-2 pb-2 flex flex-col gap-0.5 max-h-[500px] overflow-y-auto">
        {visibleNodeDefinitions.map((definition) => (
          <MenuItem
            key={definition.kind}
            icon={getVelaNodeIcon(definition.kind)}
            label={definition.label}
            desc={definition.description}
            onClick={() => onSelectNodeKind(definition.kind)}
            canvasTheme={canvasTheme}
          />
        ))}
        {!isConnector && (
          <>
            <div className={`my-1.5 border-t mx-2 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
            <div className={`px-2 pb-1 text-[11px] ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>添加资源</div>
            <MenuItem
              icon={<Upload size={16} />}
              label="上传"
              onClick={handleUploadClick}
              canvasTheme={canvasTheme}
            />
            <MenuItem
              icon={<Layers size={16} />}
              label="从生成历史选择"
              onClick={() => {
                if (onAddAssets) onAddAssets();
                onClose();
              }}
              canvasTheme={canvasTheme}
            />
          </>
        )}
      </div>
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  badge?: string;
  shortcut?: string;
  active?: boolean;
  rightSlot?: React.ReactNode;
  disabled?: boolean;
  canvasTheme?: 'dark' | 'light';
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, desc, badge, shortcut, active, rightSlot, disabled, canvasTheme = 'dark', onClick }) => {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 w-full p-2 rounded-lg text-left transition-colors 
        ${disabled
          ? (canvasTheme === 'dark' ? 'opacity-30' : 'opacity-25')
          : active
            ? (canvasTheme === 'dark' ? 'bg-[#2a2a2a] text-white' : 'bg-neutral-100 text-neutral-900')
            : (canvasTheme === 'dark' ? 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-white' : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900')}
      `}
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors
        ${active
          ? (canvasTheme === 'dark' ? 'bg-[#3a3a3a]' : 'bg-white')
          : (canvasTheme === 'dark' ? 'bg-[#151515] group-hover:bg-[#3a3a3a]' : 'bg-neutral-100 group-hover:bg-white border border-transparent group-hover:border-neutral-200')}
        ${disabled ? 'bg-transparent' : ''}
      `}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`font-medium text-sm truncate ${disabled && canvasTheme === 'light' ? 'text-neutral-400' : ''}`}>{label}</span>
          <div className="flex items-center gap-2">
            {badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${canvasTheme === 'dark' ? 'bg-neutral-800 text-neutral-400 border-neutral-700' : 'bg-neutral-100 text-neutral-500 border-neutral-200'
                }`}>
                {badge}
              </span>
            )}
            {shortcut && (
              <span className={`text-xs font-sans ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'
                }`}>{shortcut}</span>
            )}
            {rightSlot}
          </div>
        </div>
        {desc && (
          <p className={`text-xs mt-0.5 truncate ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'
            }`}>{desc}</p>
        )}
      </div>
    </button>
  );
};

const getVelaNodeIcon = (kind: VelaNodeKind) => {
  if (kind === 'prompt') return <Type size={18} />;
  if (kind === 'image-input') return <Upload size={18} />;
  if (kind === 'gpt-prompt-optimizer') return <WandSparkles size={18} />;
  if (kind === 'gpt-video' || kind === 'h3-video' || kind === 'video-result') return <Video size={18} />;
  if (kind === 'image-result') return <Film size={18} />;
  return <ImageIcon size={18} />;
};
