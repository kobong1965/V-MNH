export const IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const;
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;
export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '2K'] as const;

export const STYLE_PRESETS = [
  { id: 'none', label: '不指定', prompt: '' },
  { id: 'photo', label: '写实摄影', prompt: '写实摄影，高质量自然光，真实材质与肤质' },
  { id: 'commerce', label: '电商棚拍', prompt: '专业电商棚拍，干净背景，精确布光，商品细节清晰' },
  { id: 'cinematic', label: '电影感', prompt: '电影级构图与光影，细腻色彩分级，富有叙事氛围' },
  { id: 'fresh', label: '日系清透', prompt: '日系清透风格，柔和自然光，低饱和色彩，轻盈空气感' },
  { id: 'illustration', label: '精致插画', prompt: '精致商业插画，统一视觉语言，细节丰富，色彩协调' }
] as const;

export const composeGenerationPrompt = (
  prompt: string,
  stylePreset?: string,
  output?: { aspectRatio?: string; resolution?: string }
): string => {
  const style = STYLE_PRESETS.find((candidate) => candidate.id === stylePreset);
  const requirements = [
    output?.aspectRatio ? `画面比例 ${output.aspectRatio}` : '',
    output?.resolution && output.resolution !== 'Auto' ? `目标清晰度 ${output.resolution}` : ''
  ].filter(Boolean);
  return [
    prompt,
    style?.prompt ? `视觉风格：${style.prompt}` : '',
    requirements.length ? `输出要求：${requirements.join('，')}。` : ''
  ].filter(Boolean).join('\n\n');
};

const parseRatio = (aspectRatio: string) => {
  const [width, height] = aspectRatio.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 1;
};

const roundToProviderStep = (value: number) => Math.max(64, Math.round(value / 64) * 64);

export const resolveGenerationSize = (aspectRatio: string, resolution: string): string | undefined => {
  const longEdge = resolution === '4K' ? 4096 : resolution === '2K' ? 2048 : resolution === '1K' ? 1024 : undefined;
  if (!longEdge) return undefined;
  const ratio = parseRatio(aspectRatio);
  if (ratio >= 1) return `${longEdge}x${roundToProviderStep(longEdge / ratio)}`;
  return `${roundToProviderStep(longEdge * ratio)}x${longEdge}`;
};

export const resolveGenerationQuality = (resolution: string): 'low' | 'medium' | 'high' | undefined => {
  if (resolution === '1K') return 'low';
  if (resolution === '2K') return 'medium';
  if (resolution === '4K') return 'high';
  return undefined;
};
