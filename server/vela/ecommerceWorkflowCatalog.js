import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUNDLES_DIRECTORY = fileURLToPath(new URL('../ecommerce-workflows/', import.meta.url));

const IMAGE = (role, label, backendNodeId) => ({ role, label, kind: 'image', required: true, backendNodeId });
const VIDEO = (role, label, backendNodeId) => ({ role, label, kind: 'video', required: true, backendNodeId });
const TEXT = (role, label, defaultValue) => ({ role, label, kind: 'text', required: false, defaultValue });

export const ECOMMERCE_WORKFLOW_MANIFEST = Object.freeze([
  {
    id: 'wan22-animate-face-outfit',
    file: 'wan22-animate-face-outfit.json',
    name: 'Wan2.2 Animate 视频换脸 + 换装',
    category: 'video',
    categoryLabel: '角色视频',
    description: '保留源视频动作，在后端 Wan ComfyUI 中完成人脸与服装替换。',
    engine: 'wan-video-process',
    engineLabel: 'Wan 后端处理',
    inputs: [VIDEO('source-video', '源动作视频', '43'), IMAGE('character-image', '角色 / 服装参考图', '44')]
  },
  {
    id: 'qwen-multiview-character',
    file: 'qwen-multiview-character.json',
    name: '人物多视角生成 · 高一致性',
    category: 'portrait',
    categoryLabel: '人物重绘',
    description: '通过 GPT 图片中转生成同一人物的高一致性多视角素材。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '严格保持参考人物的身份、五官、发型、服饰与材质一致，生成专业人物多视角画面。',
    inputs: [IMAGE('character-image', '人物参考图', '434'), TEXT('view-requirement', '视角要求', '正面、左右侧面和背面，多视角构图，人物身份与服装高度一致。')]
  },
  {
    id: 'wan22-character-replace',
    file: 'wan22-character-replace.json',
    name: 'Wan2.2 视频人物角色替换',
    category: 'video',
    categoryLabel: '角色视频',
    description: '保留动作参考视频，在后端 Wan ComfyUI 中替换完整人物角色。',
    engine: 'wan-video-process',
    engineLabel: 'Wan 后端处理',
    inputs: [VIDEO('source-video', '动作参考视频', '618'), IMAGE('character-image', '待驱动角色图', '617')]
  },
  {
    id: 'dw-pose-redraw',
    file: 'dw-pose-redraw.json',
    name: 'DW 高精度人像姿态重绘',
    category: 'portrait',
    categoryLabel: '人物重绘',
    description: '通过 GPT 图片中转重绘人物姿态并保留身份与服装细节。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '以参考图为唯一人物依据，高精度重绘姿态，保持人物身份、服装结构、纹理和画面真实感。',
    inputs: [IMAGE('person-image', '人物参考图', '12'), TEXT('pose-requirement', '姿态 / 重绘要求', '保持人物身份和服饰不变，姿态自然，人体比例正确，细节清晰。')]
  },
  {
    id: 'kontext-photo-restore',
    file: 'kontext-photo-restore.json',
    name: 'Kontext 老照片修复上色',
    category: 'restore',
    categoryLabel: '修复工具',
    description: '通过 GPT 图片中转自然修复老照片并真实上色。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '修复破损、划痕、褪色和噪点，恢复自然清晰的真实细节；不得改变人物身份和原始构图。',
    inputs: [IMAGE('source-image', '待修复老照片', '15'), TEXT('restore-requirement', '修复要求', '真实自然上色，保留年代感、人物身份和原始构图。')]
  },
  {
    id: 'kontext-product-relight',
    file: 'kontext-product-relight.json',
    name: '电商产品融图打光',
    category: 'commerce',
    categoryLabel: '电商视觉',
    description: '通过 GPT 图片中转完成产品换背景、融合与渲染级打光。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '将产品自然融入目标场景，严格保持产品外观、比例、文字和商标准确，重建符合场景的接触阴影、反射与光线。',
    inputs: [IMAGE('product-image', '产品图', '140'), IMAGE('background-image', '背景 / 光线参考图', '27'), TEXT('render-requirement', '融图要求', '商业摄影质感，边缘自然，无变形，光线方向与背景一致。')]
  },
  {
    id: 'one-click-detail-page',
    file: 'one-click-detail-page.json',
    name: '一键详情页与商品海报',
    category: 'commerce',
    categoryLabel: '电商视觉',
    description: '通过 GPT 图片中转生成详情页、主图或海报视觉。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '根据商品图和风格参考生成可投放的电商主视觉，保持商品形态、比例、文字和品牌信息准确。',
    inputs: [IMAGE('product-image', '商品白底图', '10'), IMAGE('style-image', '风格参考图', '14'), TEXT('layout-requirement', '版式要求', '生成高级电商详情页首屏 / 商品海报，信息层级清晰，预留文案区域。')]
  },
  {
    id: 'precision-outfit-change',
    file: 'precision-outfit-change.json',
    name: '一键快速精准换装',
    category: 'outfit',
    categoryLabel: '服装换装',
    description: '通过 GPT 图片中转为模特精准替换指定服装。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '把服装参考图中的服装准确穿到模特身上，保持模特身份、姿态和背景不变，服装版型、颜色、纹理和图案必须准确。',
    inputs: [IMAGE('model-image', '模特图', '10'), IMAGE('garment-image', '服装商品图', '11'), TEXT('outfit-requirement', '换装要求', '自然合身，褶皱与光影真实，不改变脸部、发型和人体比例。')]
  },
  {
    id: 'character-background-change',
    file: 'character-background-change.json',
    name: '一键换背景 · 保留服饰细节',
    category: 'commerce',
    categoryLabel: '电商视觉',
    description: '通过 GPT 图片中转替换人物背景并保留人物服饰细节。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '只替换背景，严格保留人物身份、姿态、服装、饰品和细节；让新背景的透视、光线和人物边缘自然一致。',
    inputs: [IMAGE('person-image', '人物图', '13'), TEXT('background-prompt', '新背景描述', '高级自然光商业摄影棚，干净层次，背景与人物光线一致。')]
  },
  {
    id: 'fill-redux-outfit',
    file: 'fill-redux-outfit.json',
    name: '一键换装 · FILL Redux',
    category: 'outfit',
    categoryLabel: '服装换装',
    description: '通过 GPT 图片中转完成高保真商品服装替换。',
    engine: 'gpt-image',
    engineLabel: 'GPT 图片中转',
    prompt: '将服装参考准确替换到模特身上，保持脸部、发型、姿态和场景不变，完整保留服装款式、颜色、图案、材质和细节。',
    inputs: [IMAGE('model-image', '模特图', '69'), IMAGE('garment-image', '服装图', '68'), TEXT('outfit-requirement', '换装要求', '版型自然、边缘干净、真实褶皱和阴影，商品细节不可改动。')]
  }
]);

const SHA256 = (source) => crypto.createHash('sha256').update(source).digest('hex');
const COLOR_BY_KIND = Object.freeze({ image: '#27a8c7', video: '#ef6f61', text: '#7c83f7', engine: '#171b1a' });

const loadWorkflow = (entry, bundlesDirectory) => {
  const filePath = path.join(bundlesDirectory, entry.file);
  const source = fs.readFileSync(filePath);
  const workflow = JSON.parse(source.toString('utf8'));
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.links)) {
    throw new Error(`Invalid ComfyUI workflow: ${entry.file}`);
  }
  const sourceNodeIds = new Set(workflow.nodes.map((node) => String(node?.id)));
  for (const input of entry.inputs) {
    if (input.backendNodeId && !sourceNodeIds.has(String(input.backendNodeId))) {
      throw new Error(`Workflow ${entry.id} is missing backend input node ${input.backendNodeId}`);
    }
  }
  return {
    ...entry,
    sourceHash: SHA256(source),
    backendNodeCount: workflow.nodes.length,
    backendLinkCount: workflow.links.length,
    groupCount: Array.isArray(workflow.groups) ? workflow.groups.length : 0,
    sourcePath: filePath
  };
};

const buildVisibleGraph = (workflow) => {
  const nodes = workflow.inputs.map((input, index) => ({
    id: `${workflow.id}-input-${input.role}`,
    x: 20,
    y: 18 + index * 92,
    width: 210,
    height: 68,
    label: input.label,
    color: COLOR_BY_KIND[input.kind]
  }));
  const engineId = `${workflow.id}-engine`;
  nodes.push({
    id: engineId,
    x: 320,
    y: Math.max(22, 18 + ((workflow.inputs.length - 1) * 92) / 2),
    width: 230,
    height: 82,
    label: workflow.engineLabel,
    color: COLOR_BY_KIND.engine
  });
  const height = Math.max(164, workflow.inputs.length * 92 + 18);
  return {
    bounds: { x: 0, y: 0, width: 570, height },
    nodes,
    links: workflow.inputs.map((input) => ({ from: `${workflow.id}-input-${input.role}`, to: engineId }))
  };
};

const toSummary = (workflow) => ({
  id: workflow.id,
  name: workflow.name,
  category: workflow.category,
  categoryLabel: workflow.categoryLabel,
  description: workflow.description,
  engine: workflow.engine,
  engineLabel: workflow.engineLabel,
  inputCount: workflow.inputs.length,
  nodeCount: workflow.inputs.length + 1,
  linkCount: workflow.inputs.length,
  backendNodeCount: workflow.backendNodeCount,
  backendLinkCount: workflow.backendLinkCount,
  groupCount: workflow.groupCount,
  sourceHash: workflow.sourceHash,
  preview: buildVisibleGraph(workflow)
});

const createInputNode = (workflow, input, index) => ({
  id: `${workflow.id}-input-${input.role}`,
  type: input.kind === 'text' ? 'Text' : input.kind === 'video' ? 'Video' : 'Image',
  kind: input.kind === 'text' ? 'prompt' : input.kind === 'video' ? 'video-input' : 'image-input',
  title: input.label,
  x: 80,
  y: 90 + index * 330,
  canvasWidth: 360,
  canvasHeight: input.kind === 'text' ? 250 : 280,
  prompt: input.defaultValue || '',
  status: 'idle',
  parentIds: [],
  model: input.kind === 'video' ? 'video-upload' : input.kind === 'image' ? 'image-upload' : 'text-input',
  aspectRatio: input.kind === 'video' ? '9:16' : 'Auto',
  resolution: 'Original',
  backendWorkflowId: workflow.id,
  workflowInputRole: input.role,
  workflowInputRequired: input.required
});

const toProjectDraft = (workflow) => {
  const inputNodes = workflow.inputs.map((input, index) => createInputNode(workflow, input, index));
  const isWan = workflow.engine === 'wan-video-process';
  const engineNode = {
    id: `${workflow.id}-engine`,
    type: isWan ? 'Video' : 'Image',
    kind: workflow.engine,
    title: workflow.engineLabel,
    x: 600,
    y: Math.max(120, 90 + ((inputNodes.length - 1) * 330) / 2),
    canvasWidth: 420,
    canvasHeight: 360,
    prompt: workflow.prompt || '保留源视频中的动作和镜头节奏，按参考角色完成替换。',
    status: 'idle',
    parentIds: inputNodes.map((node) => node.id),
    model: isWan ? 'wan-comfyui' : 'gpt-image-relay',
    imageModel: isWan ? undefined : 'gpt-image-1',
    videoModel: isWan ? 'wan2.2-animate' : undefined,
    aspectRatio: isWan ? '9:16' : 'Auto',
    resolution: isWan ? 'Original' : '2K',
    outputCount: 1,
    backendWorkflowId: workflow.id,
    workflowEngine: workflow.engine
  };
  return {
    name: workflow.name,
    nodes: [...inputNodes, engineNode],
    groups: [],
    viewport: { x: 80, y: 70, zoom: inputNodes.length > 2 ? 0.66 : 0.78 },
    settings: {
      importedWorkflow: {
        id: workflow.id,
        format: 'vela-backend-workflow',
        engine: workflow.engine,
        sourceHash: workflow.sourceHash,
        backendNodeCount: workflow.backendNodeCount,
        visibleNodeCount: inputNodes.length + 1
      }
    }
  };
};

export class EcommerceWorkflowCatalog {
  constructor({ bundlesDirectory = DEFAULT_BUNDLES_DIRECTORY, manifest = ECOMMERCE_WORKFLOW_MANIFEST } = {}) {
    this.bundlesDirectory = path.resolve(bundlesDirectory);
    this.workflows = manifest.map((entry) => loadWorkflow(entry, this.bundlesDirectory));
    const ids = new Set(this.workflows.map((workflow) => workflow.id));
    const hashes = new Set(this.workflows.map((workflow) => workflow.sourceHash));
    if (ids.size !== this.workflows.length) throw new Error('E-commerce workflow IDs must be unique');
    if (hashes.size !== this.workflows.length) throw new Error('E-commerce workflow files must be unique');
  }

  has(workflowId) {
    return this.workflows.some((workflow) => workflow.id === workflowId);
  }

  list() {
    return this.workflows.map(toSummary);
  }

  instantiate(workflowId) {
    const workflow = this.workflows.find((item) => item.id === workflowId);
    return workflow ? toProjectDraft(workflow) : null;
  }

  getRuntimeDefinition(workflowId) {
    const workflow = this.workflows.find((item) => item.id === workflowId);
    if (!workflow) return null;
    return {
      id: workflow.id,
      engine: workflow.engine,
      inputs: workflow.inputs.map((input) => ({ ...input })),
      sourceHash: workflow.sourceHash,
      sourcePath: workflow.sourcePath
    };
  }

  loadBackendWorkflow(workflowId) {
    const definition = this.getRuntimeDefinition(workflowId);
    if (!definition) return null;
    return JSON.parse(fs.readFileSync(definition.sourcePath, 'utf8'));
  }
}

let defaultCatalog;
export const getDefaultEcommerceWorkflowCatalog = () => {
  if (!defaultCatalog) defaultCatalog = new EcommerceWorkflowCatalog();
  return defaultCatalog;
};
