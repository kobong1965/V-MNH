import type { NodeData } from '../types';

export interface VideoDirectorPersona {
  id: 'vn-grounded' | 'us-appliance' | 'custom';
  name: string;
  market: string;
  category: string;
  style: string;
  language: string;
}

export const VIDEO_DIRECTOR_PRESETS: readonly VideoDirectorPersona[] = [
  {
    id: 'vn-grounded',
    name: '越南接地气带货编导',
    market: '越南 TikTok Shop',
    category: '日用百货、服饰和高性价比商品',
    style: '生活化、可信、节奏直接，像普通用户真实体验，不做过度精致广告',
    language: '越南语口播与字幕，脚本说明使用简体中文'
  },
  {
    id: 'us-appliance',
    name: '美区小家电带货编导',
    market: '美国 TikTok Shop',
    category: '厨房、清洁、收纳和便携小家电',
    style: '前三秒问题钩子，快速演示前后变化，强调省时和使用场景，真实 UGC 质感',
    language: '自然美式英语口播与字幕，脚本说明使用简体中文'
  }
] as const;

export const resolveVideoDirectorPersona = (node: Pick<NodeData,
  'directorPresetId' | 'directorName' | 'directorMarket' | 'directorCategory' | 'directorStyle' | 'directorLanguage'
>): VideoDirectorPersona => {
  const preset = VIDEO_DIRECTOR_PRESETS.find((item) => item.id === (node.directorPresetId || 'vn-grounded'));
  if (preset) return { ...preset };
  return {
    id: 'custom',
    name: node.directorName?.trim() || '自定义视频编导',
    market: node.directorMarket?.trim() || '目标市场待补充',
    category: node.directorCategory?.trim() || '通用电商产品',
    style: node.directorStyle?.trim() || '真实、自然、可信',
    language: node.directorLanguage?.trim() || '简体中文'
  };
};
