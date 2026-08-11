import { useEffect, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ImagePlus, Loader2, Maximize2, Minus, Plus, Sparkles, X } from 'lucide-react';
import { NodeStatus, type NodeData } from '../../types';
import { getNodeDefinition } from '../nodeCatalog';
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  STYLE_PRESETS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS
} from '../generationOptions';
import type { VelaProfile } from '../services/profileService';

interface VelaNodeControlsProps {
  data: NodeData;
  isLoading: boolean;
  profileName?: string;
  profiles?: VelaProfile[];
  connectedImageNodes?: { id: string; url: string }[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
}

const GENERATION_KINDS = new Set(['gpt-prompt-optimizer', 'gpt-image', 'gpt-video', 'h3-video']);
const VIDEO_DURATIONS = [4, 5, 10, 15, 30, 60, 90, 120, 180] as const;

export function VelaNodeControls({ data, isLoading, profileName, profiles = [], connectedImageNodes = [], onUpdate, onGenerate }: VelaNodeControlsProps) {
  const [openPanel, setOpenPanel] = useState<'reference' | 'style' | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === data.profileId);
  const configuredVideoResolution = data.kind === 'gpt-video'
    ? /(?:^|[-_])(480p|720p)(?:$|[-_])/i.exec(selectedProfile?.type === 'gpt' ? selectedProfile.models.video : '')?.[1]?.toLowerCase()
    : undefined;
  useEffect(() => {
    if (configuredVideoResolution && data.resolution !== configuredVideoResolution) {
      onUpdate(data.id, { resolution: configuredVideoResolution });
    }
  }, [configuredVideoResolution, data.id, data.resolution, onUpdate]);
  if (!data.kind) return null;
  const definition = getNodeDefinition(data.kind);
  const canGenerate = GENERATION_KINDS.has(data.kind);
  const isApiVideo = data.kind === 'gpt-video';
  const isVideoGenerator = isApiVideo || data.kind === 'h3-video';
  const videoGenerationMode = data.videoGenerationMode || (connectedImageNodes.length > 0 ? 'image-to-video' : 'text-to-video');
  const needsReferenceImage = isApiVideo && videoGenerationMode === 'image-to-video' && connectedImageNodes.length === 0;
  const accountName = profileName || (data.kind === 'h3-video' ? '选择 H3 云算力' : isApiVideo ? '选择视频账户' : data.kind.startsWith('gpt-') ? '选择 GPT 账户' : definition.label);
  const isMediaGenerator = data.kind === 'gpt-image' || isVideoGenerator;
  const availableProfiles = data.kind.startsWith('gpt-')
    ? profiles.filter((profile) => profile.type === 'gpt' && (!isApiVideo || Boolean(profile.models.video)))
    : profiles.filter((profile) => profile.type === 'comfy');
  const ratios = isVideoGenerator ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS;
  const resolutions = isApiVideo
    ? configuredVideoResolution ? [configuredVideoResolution] : ['480p', '720p']
    : data.kind === 'h3-video' ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;
  const outputCount = Math.max(1, data.outputCount || 1);
  const maxOutputCount = isVideoGenerator ? 4 : 10;
  const videoDuration = Math.max(4, Math.min(180, Math.round(data.videoDuration || 5)));
  const canSubmit = canGenerate && !needsReferenceImage;
  const selectedStyle = STYLE_PRESETS.find((preset) => preset.id === data.stylePreset) || STYLE_PRESETS[0];

  return (
    <section className="vela-node-controls" aria-label={`${definition.label}参数`} onPointerDown={(event) => event.stopPropagation()}>
      {isApiVideo && (
        <div className="vela-video-mode" role="group" aria-label="视频生成模式">
          <button
            type="button"
            data-active={videoGenerationMode === 'text-to-video'}
            aria-pressed={videoGenerationMode === 'text-to-video'}
            onClick={() => onUpdate(data.id, { videoGenerationMode: 'text-to-video' })}
          >文生视频</button>
          <button
            type="button"
            data-active={videoGenerationMode === 'image-to-video'}
            aria-pressed={videoGenerationMode === 'image-to-video'}
            onClick={() => onUpdate(data.id, { videoGenerationMode: 'image-to-video' })}
          >图生视频</button>
          <span aria-live="polite">{videoGenerationMode === 'image-to-video' ? `使用 ${connectedImageNodes.length} 张参考图` : '只使用文字描述'}</span>
        </div>
      )}
      {isMediaGenerator && (
        <div className="vela-node-controls__chips" role="toolbar" aria-label="参考图和风格设置">
          <button
            type="button"
            data-active={openPanel === 'reference' || connectedImageNodes.length > 0}
            aria-expanded={openPanel === 'reference'}
            onClick={() => setOpenPanel((current) => current === 'reference' ? null : 'reference')}
          >
            <ImagePlus size={13} />参考{connectedImageNodes.length > 0 ? ` ${connectedImageNodes.length}` : ''}
          </button>
          <button
            type="button"
            data-active={openPanel === 'style' || selectedStyle.id !== 'none'}
            aria-expanded={openPanel === 'style'}
            onClick={() => setOpenPanel((current) => current === 'style' ? null : 'style')}
          >
            <Sparkles size={13} />{selectedStyle.id === 'none' ? '风格' : selectedStyle.label}
          </button>
          {openPanel && (
            <div className="vela-control-popover" role="dialog" aria-label={openPanel === 'reference' ? '参考图设置' : '风格设置'}>
              <div className="vela-control-popover__header">
                <strong>{openPanel === 'reference' ? '参考图' : '画面风格'}</strong>
                <button type="button" aria-label="关闭" onClick={() => setOpenPanel(null)}><X size={14} /></button>
              </div>
              {openPanel === 'reference' ? (
                connectedImageNodes.length > 0 ? (
                  <>
                    <div className="vela-reference-grid">
                      {connectedImageNodes.map((item, index) => (
                        <figure key={item.id} title={`参考图 ${index + 1}`}><img src={item.url} alt={`参考图 ${index + 1}`} /></figure>
                      ))}
                    </div>
                    <button className="vela-control-popover__clear" type="button" onClick={() => onUpdate(data.id, { parentIds: [] })}>清除全部参考图</button>
                  </>
                ) : <p className="vela-control-popover__empty">从图片节点右侧连接点拖到此节点，图片会作为生成参考。</p>
              ) : (
                <div className="vela-style-grid">
                  {STYLE_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      data-selected={selectedStyle.id === preset.id}
                      onClick={() => {
                        onUpdate(data.id, { stylePreset: preset.id });
                        setOpenPanel(null);
                      }}
                    >
                      <span>{preset.label}</span>{selectedStyle.id === preset.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {isMediaGenerator && connectedImageNodes.length > 0 && (
        <div className="vela-reference-strip" aria-label={`已连接 ${connectedImageNodes.length} 张参考图`}>
          {connectedImageNodes.map((item, index) => (
            <figure key={item.id} title={`参考图 ${index + 1}`}>
              <img src={item.url} alt={`参考图 ${index + 1}`} />
              <span aria-hidden="true">{index + 1}</span>
            </figure>
          ))}
        </div>
      )}
      {needsReferenceImage && <p className="vela-video-mode-hint" role="status">图生视频需要先从图片节点连接至少一张参考图。</p>}
      <div className="vela-node-controls__composer" data-expanded={data.isPromptExpanded || undefined}>
        <textarea
          value={data.prompt || ''}
          placeholder={isVideoGenerator ? '描述镜头、动作、节奏和声音…' : '写下你想生成的画面，或输入修改要求…'}
          aria-label="生成描述"
          onChange={(event) => onUpdate(data.id, { prompt: event.target.value })}
          onWheel={(event) => event.stopPropagation()}
        />
        <button
          className="vela-expand-composer"
          type="button"
          title={data.isPromptExpanded ? '收起输入框' : '展开输入框'}
          aria-label={data.isPromptExpanded ? '收起输入框' : '展开输入框'}
          onClick={() => onUpdate(data.id, { isPromptExpanded: !data.isPromptExpanded })}
        ><Maximize2 size={15} /></button>
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
            <label className="vela-setting-select" title="画面比例">
              <span className="sr-only">画面比例</span>
              <select aria-label="画面比例" value={data.aspectRatio || ratios[0]} onChange={(event) => onUpdate(data.id, { aspectRatio: event.target.value })}>
                {ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            <label className="vela-setting-select" title={isVideoGenerator ? '视频清晰度' : '图片大小'}>
              <span className="sr-only">{isVideoGenerator ? '视频清晰度' : '图片大小'}</span>
              <select aria-label={isVideoGenerator ? '视频清晰度' : '图片大小'} value={data.resolution || resolutions[0]} onChange={(event) => onUpdate(data.id, { resolution: event.target.value })}>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            {isApiVideo && (
              <label className="vela-setting-select" title="视频时长">
                <span className="sr-only">视频时长</span>
                <select aria-label="视频时长" value={videoDuration} onChange={(event) => onUpdate(data.id, { videoDuration: Number(event.target.value) })}>
                  {VIDEO_DURATIONS.map((duration) => <option key={duration} value={duration}>{duration}秒</option>)}
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            )}
            <div className="vela-output-count" role="group" aria-label="生成数量">
              <button type="button" aria-label="减少生成数量" disabled={outputCount <= 1} onClick={() => onUpdate(data.id, { outputCount: outputCount - 1 })}><Minus size={12} /></button>
              <output aria-live="polite">{outputCount}{isVideoGenerator ? '条' : '张'}</output>
              <button type="button" aria-label="增加生成数量" disabled={outputCount >= maxOutputCount} onClick={() => onUpdate(data.id, { outputCount: outputCount + 1 })}><Plus size={12} /></button>
            </div>
          </>
        )}
        <button
          type="button"
          className="vela-generate-button"
          disabled={!canSubmit || isLoading}
          aria-label={canSubmit ? '开始生成' : needsReferenceImage ? '请先连接参考图' : '当前节点无需生成'}
          title={canSubmit ? '开始生成' : needsReferenceImage ? '图生视频需要参考图' : definition.description}
          onClick={() => canSubmit && onGenerate(data.id)}
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <ArrowUp size={18} />}
        </button>
      </footer>
    </section>
  );
}
