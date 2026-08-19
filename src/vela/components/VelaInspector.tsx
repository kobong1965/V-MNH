import { SlidersHorizontal } from 'lucide-react';

import { NodeData, NodeStatus } from '../../types';
import { getNodeDefinition } from '../nodeCatalog';
import type { VelaProfile } from '../services/profileService';

interface VelaInspectorProps {
  node?: NodeData;
  profiles?: VelaProfile[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
}

const STATUS_LABELS: Record<NodeStatus, string> = {
  [NodeStatus.IDLE]: '等待设置',
  [NodeStatus.LOADING]: '正在生成',
  [NodeStatus.SUCCESS]: '已完成',
  [NodeStatus.ERROR]: '生成失败'
};

export function VelaInspector({ node, profiles = [], onUpdate }: VelaInspectorProps) {
  if (!node) return null;
  const isGptSemanticNode = node?.kind?.startsWith('gpt-') || ['video-director', 'competitor-script-analyzer'].includes(node?.kind || '');
  const availableProfiles = isGptSemanticNode
    ? profiles.filter((profile) => profile.type === 'gpt')
    : profiles.filter((profile) => profile.type === 'comfy');

  return (
    <aside className="vela-inspector vela-panel" aria-label="节点属性">
      <div className="vela-panel-heading">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <h2>节点属性</h2>
      </div>
      <div className="vela-inspector-content">
          <div>
            <p className="vela-field-label">当前节点</p>
            <p className="vela-node-name">{node.title || node.type}</p>
            <p className="vela-field-help">{node.kind ? getNodeDefinition(node.kind).description : '旧版兼容节点'}</p>
          </div>
          <div className="vela-field-row">
            <span className="vela-field-label">状态</span>
            <span className="vela-state-label" data-status={node.status}>{STATUS_LABELS[node.status]}</span>
          </div>
          {node.kind && ['gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer', 'gpt-image', 'gpt-video', 'h3-video'].includes(node.kind) && (
            <label className="vela-field-stack">
              <span className="vela-field-label">账户或算力</span>
              <select className="vela-input" value={node.profileId ?? ''} onChange={(event) => onUpdate(node.id, { profileId: event.target.value || undefined })}>
                <option value="">尚未配置</option>
                {availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <span className="vela-field-help">节点只显示账户名称，不会显示真实 Key。</span>
            </label>
          )}
          {node.kind && ['gpt-image', 'gpt-video', 'h3-video'].includes(node.kind) && (
            <label className="vela-field-stack">
              <span className="vela-field-label">生成数量</span>
              <input className="vela-input vela-utility-text" type="number" min={1} max={50} value={node.outputCount ?? 1} onChange={(event) => {
                const outputCount = Math.min(50, Math.max(1, Number(event.target.value) || 1));
                onUpdate(node.id, { outputCount });
              }} />
            </label>
          )}
          {node.kind === 'h3-video' && (
            <div className="vela-parameter-preview" aria-label="H3 默认参数预览">
              <span>模式：自动判断</span><span>比例：{node.aspectRatio || '9:16'}</span>
              <span>分辨率：{node.resolution || '1080p'}</span><span>工作流：连接算力后检测</span>
            </div>
          )}
          {node.kind === 'gpt-video' && (
            <div className="vela-parameter-preview" aria-label="API 视频参数预览">
              <span>模式：{node.videoGenerationMode === 'image-to-video' ? '图生视频' : '文生视频'}</span>
              <span>比例：{node.aspectRatio || '16:9'}</span>
              <span>清晰度：720p</span>
              <span>时长：{node.videoDuration || 5} 秒</span>
            </div>
          )}
      </div>
    </aside>
  );
}
