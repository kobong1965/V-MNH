import { SlidersHorizontal } from 'lucide-react';

import { NodeData, NodeStatus } from '../../types';
import { getNodeDefinition, isKnownVelaNodeKind } from '../nodeCatalog';
import type { VelaProfile } from '../services/profileService';
import { createVideoEngineUpdate, isMiniMaxH3Profile, type VideoEngineKind } from '../videoEngine';

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
  const isKnownKind = node.kind ? isKnownVelaNodeKind(node.kind) : true;
  const isGptSemanticNode = node?.kind?.startsWith('gpt-') || ['video-director', 'competitor-script-analyzer'].includes(node?.kind || '');
  const availableProfiles = isGptSemanticNode
    ? profiles.filter((profile) => profile.type === 'gpt')
    : node.kind === 'h3-video'
      ? profiles.filter(isMiniMaxH3Profile)
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
          {node.kind && ['gpt-video', 'h3-video'].includes(node.kind) && (
            <label className="vela-field-stack">
              <span className="vela-field-label">视频生成引擎</span>
              <select
                className="vela-input"
                aria-label="视频生成引擎"
                value={node.kind}
                onChange={(event) => onUpdate(node.id, createVideoEngineUpdate(event.target.value as VideoEngineKind, node))}
              >
                <option value="h3-video">MiniMax H3 云端算力</option>
                <option value="gpt-video">API 视频模型</option>
              </select>
              <span className="vela-field-help">切换引擎会清除不兼容的账户选择，但保留提示词、连线和已有成品。</span>
            </label>
          )}
          {node.kind && ['gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer', 'gpt-image', 'gpt-video', 'h3-video'].includes(node.kind) && (
            <label className="vela-field-stack">
              <span className="vela-field-label">账户或算力</span>
              <select className="vela-input" value={node.profileId ?? ''} onChange={(event) => onUpdate(node.id, { profileId: event.target.value || undefined })}>
                <option value="">{node.kind === 'h3-video' ? '自动分配（推荐）' : '尚未配置'}</option>
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
              <span>模式：{node.videoGenerationMode === 'reference-to-video' ? 'R2V 参考素材视频' : node.videoGenerationMode === 'image-to-video' ? '图生视频' : '文生视频'}</span>
              <span>比例：{node.aspectRatio || '16:9'}</span>
              <span>清晰度：720p</span>
              <span>时长：{node.videoDuration || 5} 秒</span>
            </div>
          )}
          {node.kind === 'storyworks-reference' && (
            <div className="vela-parameter-preview" role="note" aria-label="Storyworks 参考信息">
              <span>来源：Storyworks</span><span>模式：只读同步</span>
              <span>用途：连续性参考</span><span>下游：自动加入提示词</span>
            </div>
          )}
          {node.kind && !isKnownKind && (
            <p className="vela-field-help" role="status">此节点正在兼容模式下显示，原始内容已保留。</p>
          )}
      </div>
    </aside>
  );
}
