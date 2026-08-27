import type { NodeData } from '../types';
import type { VelaProfile } from './services/profileService';

export type VideoEngineKind = 'gpt-video' | 'h3-video';

export const isMiniMaxH3Profile = (profile: VelaProfile): boolean => profile.type === 'comfy' && (
  /^minimax-h3/i.test(profile.workflowVersion || '')
  || /minimax\s*h3/i.test(profile.name)
  || (profile.tags || []).some((tag) => /minimax\s*h3/i.test(tag))
);

export const normalizeH3VideoDuration = (seconds?: number): 5 | 10 | 15 => {
  const value = Math.max(1, Math.round(seconds || 5));
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  return 15;
};

export function createVideoEngineUpdate(engine: VideoEngineKind, node: NodeData): Partial<NodeData> {
  const common: Partial<NodeData> = {
    kind: engine,
    model: 'video-generator',
    profileId: undefined,
    status: 'idle' as NodeData['status'],
    generationProgress: undefined,
    errorMessage: undefined,
    jobGroupId: undefined
  };

  if (engine === 'h3-video') {
    return {
      ...common,
      videoModel: 'minimax-h3',
      videoDuration: normalizeH3VideoDuration(node.videoDuration),
      videoGenerationMode: 'reference-to-video',
      resolution: ['480p', '720p', '1080p', '2K'].includes(node.resolution) ? node.resolution : '720p',
      h3Acceleration: node.h3Acceleration === 'standard' ? 'standard' : 'turbo-4',
      h3Upscale: node.h3Upscale || 'off',
      h3FrameFit: undefined,
      h3OutpaintProfileId: undefined,
      h3ReferenceImageSize: node.h3ReferenceImageSize || 'match'
    };
  }

  return {
    ...common,
    videoModel: '未选择',
    videoDuration: Math.max(4, Math.min(180, Math.round(node.videoDuration || 5))),
    videoGenerationMode: node.videoGenerationMode || ((node.parentIds || []).length > 0 ? 'image-to-video' : 'text-to-video'),
    resolution: ['480p', '720p'].includes(node.resolution) ? node.resolution : '720p'
  };
}
