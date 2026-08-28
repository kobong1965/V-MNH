import { useEffect, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Film, ImagePlus, Loader2, Maximize2, Minus, Plus, ScanSearch, Sparkles, UserRoundCog, X } from 'lucide-react';
import { NodeStatus, NodeType, type NodeData } from '../../types';
import { getNodeDefinition, isKnownVelaNodeKind } from '../nodeCatalog';
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  STYLE_PRESETS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS
} from '../generationOptions';
import type { VelaProfile } from '../services/profileService';
import { createVideoEngineUpdate, isMiniMaxH3Profile, type VideoEngineKind } from '../videoEngine';
import { resolveVideoDirectorPersona, VIDEO_DIRECTOR_PRESETS } from '../videoDirectorPresets';

interface VelaNodeControlsProps {
  data: NodeData;
  isLoading: boolean;
  profileName?: string;
  profiles?: VelaProfile[];
  connectedImageNodes?: { id: string; url: string; type?: NodeType; sourceAssetId?: string }[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
}

const GENERATION_KINDS = new Set(['gpt-prompt-optimizer', 'video-director', 'competitor-script-analyzer', 'gpt-image', 'gpt-video', 'h3-video', 'wan-video-process']);
const VIDEO_DURATIONS = [4, 5, 10, 15, 30, 60, 90, 120, 180] as const;

export function VelaNodeControls({ data, isLoading, profileName, profiles = [], connectedImageNodes = [], onUpdate, onGenerate }: VelaNodeControlsProps) {
  const [openPanel, setOpenPanel] = useState<'reference' | 'style' | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === data.profileId);
  const isVideoDirector = data.kind === 'video-director';
  const isCompetitorAnalyzer = data.kind === 'competitor-script-analyzer';
  const isScriptNode = isVideoDirector || isCompetitorAnalyzer;
  const isGptNode = data.kind?.startsWith('gpt-') || isScriptNode;
  const connectedImageCount = connectedImageNodes.filter((item) => item.type !== NodeType.VIDEO).length;
  const connectedVideoCount = connectedImageNodes.filter((item) => item.type === NodeType.VIDEO).length;
  const directorPersona = resolveVideoDirectorPersona(data);
  const configuredVideoResolution = data.kind === 'gpt-video'
    ? /(?:^|[-_])(480p|720p)(?:$|[-_])/i.exec(selectedProfile?.type === 'gpt' ? selectedProfile.models.video : '')?.[1]?.toLowerCase()
    : undefined;
  useEffect(() => {
    if (configuredVideoResolution && data.resolution !== configuredVideoResolution) {
      onUpdate(data.id, { resolution: configuredVideoResolution });
    }
  }, [configuredVideoResolution, data.id, data.resolution, onUpdate]);
  useEffect(() => {
    const comfyProfiles = profiles.filter((profile) => profile.type === 'comfy');
    if (data.kind === 'wan-video-process' && !data.profileId && comfyProfiles.length === 1) {
      onUpdate(data.id, { profileId: comfyProfiles[0].id });
    }
  }, [data.id, data.kind, data.profileId, onUpdate, profiles]);
  useEffect(() => {
    if (data.kind === 'h3-video' && data.videoGenerationMode !== 'reference-to-video') {
      onUpdate(data.id, {
        videoGenerationMode: 'reference-to-video',
        h3Acceleration: data.h3Acceleration === 'standard' ? 'standard' : 'turbo-4',
        h3FrameFit: undefined,
        h3OutpaintProfileId: undefined
      });
    }
  }, [data.h3Acceleration, data.id, data.kind, data.videoGenerationMode, onUpdate]);
  if (!data.kind) return null;
  const definition = getNodeDefinition(data.kind);
  const isKnownKind = isKnownVelaNodeKind(data.kind);
  if (!isKnownKind || data.kind === 'storyworks-reference') {
    return (
      <section
        className="vela-node-controls vela-node-controls--notice"
        aria-label={isKnownKind ? 'Storyworks 参考说明' : '兼容节点说明'}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <strong>{isKnownKind ? 'Storyworks 连续性参考' : '兼容模式'}</strong>
        <span>{isKnownKind ? '此节点由 Storyworks 同步，只读保留并自动参与下游提示词。' : definition.description}</span>
      </section>
    );
  }
  const canGenerate = GENERATION_KINDS.has(data.kind);
  const isApiVideo = data.kind === 'gpt-video';
  const isH3Video = data.kind === 'h3-video';
  const isWanProcess = data.kind === 'wan-video-process';
  const isVideoGenerator = isApiVideo || isH3Video;
  const videoGenerationMode = isH3Video ? 'reference-to-video' : data.videoGenerationMode || (connectedImageNodes.length > 0 ? 'image-to-video' : 'text-to-video');
  const requiredReferenceNodeIds = data.requiredReferenceNodeIds ?? [];
  const connectedReadyIds = new Set(connectedImageNodes.map((node) => node.id));
  const linkedIds = new Set(data.parentIds ?? []);
  const missingRequiredReferenceNodeIds = requiredReferenceNodeIds.filter((nodeId) => !linkedIds.has(nodeId) || !connectedReadyIds.has(nodeId));
  const needsReferenceImage = isH3Video
    ? connectedImageNodes.length === 0 || missingRequiredReferenceNodeIds.length > 0 || connectedImageNodes.length > 9
    : isVideoGenerator && videoGenerationMode === 'image-to-video' && connectedImageNodes.length === 0;
  const wanInputMissing = isWanProcess && (connectedImageCount === 0 || connectedVideoCount === 0);
  const accountPlaceholder = isWanProcess ? '选择 Wan ComfyUI 算力' : data.kind === 'h3-video' ? '自动分配（推荐）' : isCompetitorAnalyzer ? '选择含 Qwen 的账户' : isApiVideo ? '选择视频账户' : isGptNode ? '选择 GPT 账户' : definition.label;
  const accountName = profileName || accountPlaceholder;
  const isMediaGenerator = data.kind === 'gpt-image' || isVideoGenerator;
  const availableProfiles = isGptNode
    ? profiles.filter((profile) => profile.type === 'gpt' && (!isApiVideo || Boolean(profile.models.video)) && (!isCompetitorAnalyzer || Boolean(profile.models.analysis)))
    : isH3Video
      ? profiles.filter(isMiniMaxH3Profile)
      : profiles.filter((profile) => profile.type === 'comfy');
  const ratios = isVideoGenerator ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS;
  const resolutions = isApiVideo
    ? configuredVideoResolution ? [configuredVideoResolution] : ['480p', '720p']
    : data.kind === 'h3-video' ? VIDEO_RESOLUTIONS : IMAGE_RESOLUTIONS;
  const outputCount = Math.max(1, data.outputCount || 1);
  const maxOutputCount = isVideoGenerator ? 4 : 10;
  const videoDuration = Math.max(4, Math.min(180, Math.round(data.videoDuration || 5)));
  const scriptInputMissing = isVideoDirector
    ? connectedImageCount === 0
    : isCompetitorAnalyzer
      ? connectedImageCount === 0 || connectedVideoCount === 0
      : false;
  const submissionBlocked = Boolean(data.submissionBlocked);
  const canSubmit = canGenerate && !submissionBlocked && !needsReferenceImage && !scriptInputMissing && !wanInputMissing;
  const selectedStyle = STYLE_PRESETS.find((preset) => preset.id === data.stylePreset) || STYLE_PRESETS[0];

  return (
    <section className="vela-node-controls" aria-label={`${definition.label}参数`} onPointerDown={(event) => event.stopPropagation()}>
      {isVideoDirector && (
        <div className="vela-script-config" aria-label="视频编导人设">
          <div className="vela-script-config__heading"><UserRoundCog size={16} /><strong>编导身份</strong></div>
          <label>
            <span>人设预设</span>
            <select
              value={data.directorPresetId || 'vn-grounded'}
              onChange={(event) => {
                const presetId = event.target.value as NodeData['directorPresetId'];
                const preset = VIDEO_DIRECTOR_PRESETS.find((item) => item.id === presetId);
                onUpdate(data.id, {
                  directorPresetId: presetId,
                  ...(preset ? {
                    directorName: preset.name,
                    directorMarket: preset.market,
                    directorCategory: preset.category,
                    directorStyle: preset.style,
                    directorLanguage: preset.language
                  } : {})
                });
              }}
            >
              {VIDEO_DIRECTOR_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              <option value="custom">自定义编导</option>
            </select>
          </label>
          {data.directorPresetId === 'custom' ? (
            <div className="vela-script-config__grid">
              <label><span>人设名称</span><input value={data.directorName || ''} onChange={(event) => onUpdate(data.id, { directorName: event.target.value })} /></label>
              <label><span>目标市场</span><input value={data.directorMarket || ''} onChange={(event) => onUpdate(data.id, { directorMarket: event.target.value })} /></label>
              <label><span>擅长品类</span><input value={data.directorCategory || ''} onChange={(event) => onUpdate(data.id, { directorCategory: event.target.value })} /></label>
              <label><span>输出语言</span><input value={data.directorLanguage || ''} onChange={(event) => onUpdate(data.id, { directorLanguage: event.target.value })} /></label>
              <label className="vela-script-config__wide"><span>表达风格</span><input value={data.directorStyle || ''} onChange={(event) => onUpdate(data.id, { directorStyle: event.target.value })} /></label>
            </div>
          ) : <p>{directorPersona.market} · {directorPersona.category}<br />{directorPersona.style}</p>}
          <div className="vela-script-input-state" data-ready={connectedImageCount > 0}><ImagePlus size={14} />已连接 {connectedImageCount} 张产品图</div>
          <div
            className="vela-script-model"
            data-ready={Boolean(selectedProfile?.type === 'gpt')}
            role="status"
            title="生成时读取所选账户的模型列表，优先使用版本最高的 GPT 旗舰模型"
          >
            <Sparkles size={14} aria-hidden="true" />
            {selectedProfile?.type === 'gpt'
              ? data.lastDirectorModel
                ? `自动最高 GPT · 上次使用 ${data.lastDirectorModel}`
                : `自动最高 GPT · 生成时检测${selectedProfile.models.prompt ? `（回退 ${selectedProfile.models.prompt}）` : ''}`
              : '自动最高 GPT · 请先选择账户'}
          </div>
        </div>
      )}
      {isCompetitorAnalyzer && (
        <div className="vela-script-config" aria-label="竞品视频分析输入">
          <div className="vela-script-config__heading"><ScanSearch size={16} /><strong>Qwen 竞品分析</strong></div>
          <div className="vela-script-inputs">
            <span data-ready={connectedVideoCount > 0}><Film size={14} />对标视频 {connectedVideoCount}</span>
            <span data-ready={connectedImageCount > 0}><ImagePlus size={14} />产品图 {connectedImageCount}</span>
          </div>
          <p>将均匀抽取 {data.analysisFrameCount || 8} 帧，只学习镜头、节奏和卖点表达，不复制人物、品牌或水印。</p>
          <div className="vela-script-model" data-ready={Boolean(selectedProfile?.type === 'gpt' && selectedProfile.models.analysis)}>
            Qwen 模型：{selectedProfile?.type === 'gpt' ? selectedProfile.models.analysis || '未配置' : '请先选择账户'}
          </div>
        </div>
      )}
      {isVideoGenerator && (
        <label className="vela-video-engine">
          <span>视频生成引擎</span>
          <select
            aria-label="视频生成引擎"
            value={data.kind}
            onChange={(event) => onUpdate(data.id, createVideoEngineUpdate(event.target.value as VideoEngineKind, data))}
          >
            <option value="h3-video">MiniMax H3 云端算力</option>
            <option value="gpt-video">API 视频模型</option>
          </select>
          <small>{isH3Video ? '可自动分配两台 H3 GPU，也可在下方指定算力。' : '使用已配置的视频 API 账户。'}</small>
        </label>
      )}
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
      {isH3Video && (
        <div className="vela-video-mode" role="status" aria-label="H3 R2V 参考素材模式">
          <button type="button" data-active aria-pressed disabled>R2V 参考素材视频</button>
          <span>{requiredReferenceNodeIds.length
            ? `必需素材 ${connectedImageNodes.length}/${requiredReferenceNodeIds.length}`
            : `已连接 ${connectedImageNodes.length} 张参考图`}</span>
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
      {needsReferenceImage && <p className="vela-video-mode-hint" role="status">{isH3Video
        ? connectedImageNodes.length > 9
          ? `H3 R2V 最多支持 9 张图，当前已连接 ${connectedImageNodes.length} 张。`
          : missingRequiredReferenceNodeIds.length
            ? `本镜头还有 ${missingRequiredReferenceNodeIds.length} 个必需的人物、场景或道具素材未连接或未就绪。`
            : 'H3 R2V 需要先连接至少一张参考素材。'
        : '图生视频需要先从图片节点连接至少一张参考图。'}</p>}
      {submissionBlocked && (
        <p className="vela-video-mode-hint" role="alert">该节点有一次提交未获得远程任务 ID。请先人工核对远端任务与扣费；核对前禁止再次生成。</p>
      )}
      {isH3Video && !needsReferenceImage && (
        <p className="vela-video-mode-hint">全部人物、场景和道具参考图会按连线顺序作为 &lt;Picture 1...N&gt; 一起送入 Ref2VA；不会生成首帧。</p>
      )}
      {isWanProcess && <p className="vela-video-mode-hint" role="status">{wanInputMissing ? '请连接一张角色参考图和一条动作参考视频。' : '输入已就绪；完整 Wan 工作流将在后端运行，源视频动作会被保留。'}</p>}
      {!isWanProcess && <div className="vela-node-controls__composer" data-expanded={data.isPromptExpanded || undefined}>
        <textarea
          value={isScriptNode ? data.sourceBrief || '' : data.prompt || ''}
          placeholder={isVideoDirector ? '补充产品卖点、目标人群、时长或禁用内容…' : isCompetitorAnalyzer ? '补充希望借鉴的结构、目标市场和产品卖点…' : isH3Video ? '商品信息：米白色儿童贝雷帽…\n关键词：真实 UGC、自然阳光、越南家庭…\n场景与镜头：妈妈给孩子戴帽，近景展示刺绣…' : isVideoGenerator ? '描述镜头、动作、节奏和声音…' : '写下你想生成的画面，或输入修改要求…'}
          aria-label={isScriptNode ? '产品与脚本补充要求' : isH3Video ? '商品信息关键词与视频场景' : '生成描述'}
          onChange={(event) => onUpdate(data.id, isScriptNode ? { sourceBrief: event.target.value } : { prompt: event.target.value })}
          onWheel={(event) => event.stopPropagation()}
        />
        <button
          className="vela-expand-composer"
          type="button"
          title={data.isPromptExpanded ? '收起输入框' : '展开输入框'}
          aria-label={data.isPromptExpanded ? '收起输入框' : '展开输入框'}
          onClick={() => onUpdate(data.id, { isPromptExpanded: !data.isPromptExpanded })}
        ><Maximize2 size={15} /></button>
      </div>}
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
                jobGroupId: undefined,
                lastDirectorModel: undefined
              })}
            >
              <option value="">{accountPlaceholder}</option>
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
            {isVideoGenerator && (
              <label className="vela-setting-select" title="视频时长">
                <span className="sr-only">视频时长</span>
                <select aria-label="视频时长" value={videoDuration} onChange={(event) => onUpdate(data.id, { videoDuration: Number(event.target.value) })}>
                  {(isH3Video ? VIDEO_DURATIONS.filter((duration) => [5, 10, 15].includes(duration)) : VIDEO_DURATIONS).map((duration) => <option key={duration} value={duration}>{duration}秒</option>)}
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            )}
            {isH3Video && (
              <label className="vela-setting-select" title="H3 生成速度">
                <span className="sr-only">H3 生成速度</span>
                <select aria-label="H3 生成速度" value={data.h3Acceleration === 'standard' ? 'standard' : 'turbo-4'} onChange={(event) => onUpdate(data.id, { h3Acceleration: event.target.value as NodeData['h3Acceleration'] })}>
                  <option value="turbo-4">极速 4步</option>
                  <option value="standard">标准 20步</option>
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            )}
            {isH3Video && (
              <label className="vela-setting-select" title="R2V 参考图精度">
                <span className="sr-only">R2V 参考图精度</span>
                <select aria-label="R2V 参考图精度" value={data.h3ReferenceImageSize || 'match'} onChange={(event) => onUpdate(data.id, { h3ReferenceImageSize: event.target.value as NodeData['h3ReferenceImageSize'] })}>
                  <option value="match">标准参考</option>
                  <option value="max">身份细节优先</option>
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </label>
            )}
            {isH3Video && ['1080p', '2K'].includes(data.resolution || '') && (
              <label className="vela-setting-select" title="AI 高清增强">
                <span className="sr-only">AI 高清增强</span>
                <select aria-label="AI 高清增强" value={data.h3Upscale || 'auto'} onChange={(event) => onUpdate(data.id, { h3Upscale: event.target.value as NodeData['h3Upscale'] })}>
                  <option value="auto">AI 高清</option>
                  <option value="off">关闭高清</option>
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
          aria-label={submissionBlocked ? '提交待核对，禁止生成' : canSubmit ? '开始生成' : wanInputMissing ? '请连接角色图和动作视频' : scriptInputMissing ? isCompetitorAnalyzer ? '请连接一条对标视频和产品图' : '请连接产品图' : needsReferenceImage ? '请连接全部必需参考素材' : '当前节点无需生成'}
          title={submissionBlocked ? '请先核对远端任务和扣费，防止重复提交' : canSubmit ? '开始生成' : wanInputMissing ? 'Wan 处理需要一张角色参考图和一条动作参考视频' : scriptInputMissing ? isCompetitorAnalyzer ? '竞品分析需要一条对标视频和至少一张产品图' : '视频编导需要至少一张产品图' : needsReferenceImage ? 'H3 R2V 必须连接全部必需人物、场景和道具参考图' : definition.description}
          onClick={() => canSubmit && onGenerate(data.id)}
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <ArrowUp size={18} />}
        </button>
      </footer>
    </section>
  );
}
