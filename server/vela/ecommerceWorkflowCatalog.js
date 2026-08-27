import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUNDLES_DIRECTORY = fileURLToPath(new URL('../ecommerce-workflows/', import.meta.url));

const IMAGE = (role, label, backendNodeId) => ({ role, label, kind: 'image', required: true, backendNodeId });
const VIDEO = (role, label, backendNodeId) => ({ role, label, kind: 'video', required: true, backendNodeId });
const TEXT = (role, label, defaultValue) => ({ role, label, kind: 'text', required: false, defaultValue });

export const ECOMMERCE_WORKFLOW_MANIFEST = Object.freeze([]);

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
