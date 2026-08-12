import { useEffect, useState } from 'react';
import { Play, Save, Trash2, Workflow, X } from 'lucide-react';
import type { NodeData, NodeGroup } from '../../types';
import {
  deleteVelaWorkflowTemplate,
  instantiateVelaWorkflowTemplate,
  listVelaWorkflowTemplates,
  saveVelaWorkflowTemplate,
  type VelaWorkflowTemplate
} from '../services/workflowTemplateService';

interface VelaWorkflowPanelProps {
  isOpen: boolean;
  nodes: NodeData[];
  groups: NodeGroup[];
  currentProjectId?: string;
  onEnsureProjectId: () => Promise<string | null>;
  onClose: () => void;
  onUse: (template: VelaWorkflowTemplate) => void;
}

export function VelaWorkflowPanel({
  isOpen,
  nodes,
  groups,
  currentProjectId,
  onEnsureProjectId,
  onClose,
  onUse
}: VelaWorkflowPanelProps) {
  const [name, setName] = useState('');
  const [items, setItems] = useState<Awaited<ReturnType<typeof listVelaWorkflowTemplates>>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    try { setItems(await listVelaWorkflowTemplates()); }
    catch (error) { setMessage(error instanceof Error ? error.message : '读取工作流失败'); }
  };

  useEffect(() => { if (isOpen) void refresh(); }, [isOpen]);
  if (!isOpen) return null;

  const ensureProjectId = async () => {
    const projectId = currentProjectId || await onEnsureProjectId();
    if (!projectId) throw new Error('请先保存当前项目');
    return projectId;
  };

  const saveCurrent = async () => {
    if (!name.trim()) return setMessage('请先输入工作流名称');
    if (nodes.length === 0) return setMessage('当前画布没有可保存的节点');
    try {
      setBusy(true);
      await saveVelaWorkflowTemplate({
        name: name.trim(),
        projectId: await ensureProjectId(),
        nodes,
        groups
      });
      setName('');
      setMessage('工作流和全部画布素材已保存');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally { setBusy(false); }
  };

  return (
    <aside className="vela-workflow-panel vela-panel" aria-label="工作流" onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <span><Workflow size={16} aria-hidden="true" />工作流</span>
        <button type="button" onClick={onClose} aria-label="关闭工作流"><X size={16} /></button>
      </header>
      <p>保存整个画布的节点、连线、参数和图片/视频素材，可在新项目中完整复用。</p>
      <div className="vela-workflow-save-row">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：买家秀工作流" aria-label="工作流名称" />
        <button type="button" disabled={busy} onClick={() => void saveCurrent()}><Save size={14} />保存</button>
      </div>
      {message && <div className="vela-workflow-message" role="status">{message}</div>}
      <div className="vela-workflow-list">
        {items.length === 0 ? <div className="vela-workflow-empty">还没有保存的工作流</div> : items.map((item) => (
          <article key={item.id}>
            <div><strong>{item.name}</strong><span>{item.nodeCount} 个节点 · {item.assetCount || 0} 个素材</span></div>
            <button type="button" disabled={busy} onClick={async () => {
              try {
                setBusy(true);
                onUse(await instantiateVelaWorkflowTemplate(item.id, await ensureProjectId()));
                onClose();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '使用失败');
              } finally { setBusy(false); }
            }}><Play size={13} />使用</button>
            <button type="button" disabled={busy} aria-label={`删除工作流 ${item.name}`} onClick={async () => {
              try {
                setBusy(true);
                await deleteVelaWorkflowTemplate(item.id);
                await refresh();
              } finally { setBusy(false); }
            }}><Trash2 size={13} /></button>
          </article>
        ))}
      </div>
    </aside>
  );
}
