export type VelaNodeKind =
  | 'prompt'
  | 'image-input'
  | 'gpt-prompt-optimizer'
  | 'gpt-image'
  | 'gpt-video'
  | 'h3-video'
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
    kind: 'gpt-prompt-optimizer',
    label: 'GPT 提示词优化',
    description: '把简单想法整理成可生成的提示词',
    category: 'gpt',
    legacyType: 'Text',
    inputs: ['text', 'image'],
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
