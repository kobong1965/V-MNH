import { ArrowUp, ImagePlus, Loader2, Maximize2, Sparkles } from 'lucide-react';
import { NodeStatus, type NodeData } from '../../types';
import { getNodeDefinition } from '../nodeCatalog';
import type { VelaProfile } from '../services/profileService';

interface VelaNodeControlsProps {
  data: NodeData;
  isLoading: boolean;
  profileName?: string;
  profiles?: VelaProfile[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
}

const GENERATION_KINDS = new Set(['gpt-prompt-optimizer', 'gpt-image', 'h3-video']);

export function VelaNodeControls({ data, isLoading, profileName, profiles = [], onUpdate, onGenerate }: VelaNodeControlsProps) {
  if (!data.kind) return null;
  const definition = getNodeDefinition(data.kind);
  const canGenerate = GENERATION_KINDS.has(data.kind);
  const accountName = profileName || (data.kind === 'h3-video' ? '选择 H3 云算力' : data.kind.startsWith('gpt-') ? '选择 GPT 账户' : definition.label);
  const isMediaGenerator = data.kind === 'gpt-image' || data.kind === 'h3-video';
  const availableProfiles = data.kind.startsWith('gpt-')
    ? profiles.filter((profile) => profile.type === 'gpt')
    : profiles.filter((profile) => profile.type === 'comfy');

  return (
    <section className="vela-node-controls" aria-label={`${definition.label}参数`} onPointerDown={(event) => event.stopPropagation()}>
      {isMediaGenerator && (
        <div className="vela-node-controls__chips">
          <button type="button"><ImagePlus size={13} />参考</button>
          <button type="button"><Sparkles size={13} />风格</button>
        </div>
      )}
      <div className="vela-node-controls__composer">
        <textarea
          value={data.prompt || ''}
          placeholder={data.kind === 'h3-video' ? '描述镜头、动作、节奏和声音…' : '写下你想生成的画面，或输入修改要求…'}
          aria-label="生成描述"
          onChange={(event) => onUpdate(data.id, { prompt: event.target.value })}
          onWheel={(event) => event.stopPropagation()}
        />
        <button className="vela-expand-composer" type="button" title="展开输入框" aria-label="展开输入框"><Maximize2 size={15} /></button>
      </div>
      <footer className="vela-node-controls__footer">
        <label className="vela-model-name" title="账户或算力只显示名称">
          <Sparkles size={14} aria-hidden="true" />
          {canGenerate ? (
            <select
              className="vela-model-select"
              aria-label="账户或算力"
              value={data.profileId || ''}
              onChange={(event) => onUpdate(data.id, {
                profileId: event.target.value || undefined,
                status: NodeStatus.IDLE,
                errorMessage: undefined,
                jobGroupId: undefined
              })}
            >
              <option value="">{accountName}</option>
              {availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          ) : <span>{accountName}</span>}
        </label>
        {isMediaGenerator && (
          <>
            <span className="vela-control-separator" aria-hidden="true" />
            <span>{data.aspectRatio || '9:16'}</span>
            <span>·</span>
            <span>{data.resolution || (data.kind === 'h3-video' ? '1080p' : '2K')}</span>
            <span>·</span>
            <label className="vela-output-count">{data.outputCount || 1} {data.kind === 'h3-video' ? '条' : '张'}
              <input
                aria-label="生成数量"
                type="number"
                min={1}
                max={50}
                value={data.outputCount || 1}
                onChange={(event) => onUpdate(data.id, { outputCount: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })}
              />
            </label>
          </>
        )}
        <button
          type="button"
          className="vela-generate-button"
          disabled={!canGenerate || isLoading}
          aria-label={canGenerate ? '开始生成' : '当前节点无需生成'}
          title={canGenerate ? '开始生成' : definition.description}
          onClick={() => canGenerate && onGenerate(data.id)}
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <ArrowUp size={18} />}
        </button>
      </footer>
    </section>
  );
}
