export type VelaNodeKind =
  | 'prompt'
  | 'image-input'
  | 'video-input'
  | 'gpt-prompt-optimizer'
  | 'video-director'
  | 'competitor-script-analyzer'
  | 'gpt-image'
  | 'gpt-video'
  | 'h3-video'
  | 'wan-video-process'
  | 'image-result'
  | 'video-result';

export type VelaPortType =
  | 'text'
  | 'image'
  | 'video'
  | 'image-list'
  | 'video-list';

export type VelaLegacyNodeType = 'Text' | 'Image' | 'Video';

export interface VelaNodeDefinition {
  kind: VelaNodeKind;
  label: string;
  description: string;
  category: 'input' | 'gpt' | 'video' | 'result';
  legacyType: VelaLegacyNodeType;
  inputs: VelaPortType[];
  outputs: VelaPortType[];
  defaultPrompt?: string;
}

export const VELA_NODE_CATALOG: readonly VelaNodeDefinition[] = [
  {
    kind: 'prompt',
    label: '提示词',
    description: '输入创意、动作和画面要求',
    category: 'input',
    legacyType: 'Text',
    inputs: [],
    outputs: ['text']
  },
  {
    kind: 'image-input',
    label: '图片输入',
    description: '拖入或选择本地参考图',
    category: 'input',
    legacyType: 'Image',
    inputs: [],
    outputs: ['image']
  },
  {
    kind: 'video-input',
    label: '视频输入',
    description: '拖入或选择本地动作参考视频',
    category: 'input',
    legacyType: 'Video',
    inputs: [],
    outputs: ['video']
  },
  {
    kind: 'gpt-prompt-optimizer',
    label: 'GPT 提示词优化',
    description: '把简单想法整理成可生成的提示词',
    category: 'gpt',
    legacyType: 'Text',
    inputs: ['text', 'image'],
    outputs: ['text']
  },
  {
    kind: 'video-director',
    label: '视频编导',
    description: '按市场和品类人设生成带货脚本与视频提示词',
    category: 'gpt',
    legacyType: 'Text',
    inputs: ['text', 'image', 'image-list'],
    outputs: ['text']
  },
  {
    kind: 'competitor-script-analyzer',
    label: '竞品视频分析',
    description: '使用 Qwen 拆解对标视频并生成原创脚本',
    category: 'gpt',
    legacyType: 'Text',
    inputs: ['text', 'image', 'image-list', 'video', 'video-list'],
    outputs: ['text']
  },
  {
    kind: 'gpt-image',
    label: 'GPT 图片',
    description: '使用所选 GPT 账户生成图片',
    category: 'gpt',
    legacyType: 'Image',
    inputs: ['text', 'image', 'image-list'],
    outputs: ['image-list']
  },
  {
    kind: 'gpt-video',
    label: 'API 视频',
    description: '通过视频中转账户生成文生视频或图生视频',
    category: 'video',
    legacyType: 'Video',
    inputs: ['text', 'image', 'image-list'],
    outputs: ['video-list']
  },
  {
    kind: 'h3-video',
    label: 'H3 视频',
    description: '通过云端 ComfyUI 生成视频',
    category: 'video',
    legacyType: 'Video',
    inputs: ['text', 'image'],
    outputs: ['video-list']
  },
  {
    kind: 'wan-video-process',
    label: 'Wan 视频处理',
    description: '在后端 ComfyUI 保留源动作并替换人物角色或服装',
    category: 'video',
    legacyType: 'Video',
    inputs: ['video', 'image'],
    outputs: ['video-list']
  },
  {
    kind: 'image-result',
    label: '图片结果',
    description: '预览和保存生成图片',
    category: 'result',
    legacyType: 'Image',
    inputs: ['image', 'image-list'],
    outputs: ['image', 'image-list']
  },
  {
    kind: 'video-result',
    label: '视频结果',
    description: '播放和保存生成视频',
    category: 'result',
    legacyType: 'Video',
    inputs: ['video', 'video-list'],
    outputs: ['video', 'video-list']
  }
] as const;

const NODE_DEFINITIONS = new Map(
  VELA_NODE_CATALOG.map((definition) => [definition.kind, definition])
);

export const getNodeDefinition = (kind: VelaNodeKind): VelaNodeDefinition => {
  const definition = NODE_DEFINITIONS.get(kind);
  if (!definition) {
    throw new Error(`Unknown Vela node kind: ${kind}`);
  }
  return definition;
};

const singularPort = (port: VelaPortType): VelaPortType => {
  if (port === 'image-list') return 'image';
  if (port === 'video-list') return 'video';
  return port;
};

export const arePortsCompatible = (
  output: VelaPortType,
  input: VelaPortType
): boolean => singularPort(output) === singularPort(input);

export const canConnectNodeKinds = (
  parentKind: VelaNodeKind,
  childKind: VelaNodeKind
): boolean => {
  const parent = getNodeDefinition(parentKind);
  const child = getNodeDefinition(childKind);

  return parent.outputs.some((output) =>
    child.inputs.some((input) => arePortsCompatible(output, input))
  );
};

export const getDefaultNodeTitle = (kind: VelaNodeKind): string =>
  getNodeDefinition(kind).label;
