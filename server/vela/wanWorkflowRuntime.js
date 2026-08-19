import { ComfyUiError } from '../providers/comfyUiProvider.js';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const setLoadImageValue = (node, remotePath) => {
  if (Array.isArray(node.widgets_values)) {
    node.widgets_values[0] = remotePath;
    return;
  }
  if (node.widgets_values && typeof node.widgets_values === 'object') {
    node.widgets_values.image = remotePath;
    return;
  }
  node.widgets_values = [remotePath, 'image'];
};

const setLoadVideoValue = (node, remotePath) => {
  if (Array.isArray(node.widgets_values)) {
    node.widgets_values[0] = remotePath;
    return;
  }
  const current = node.widgets_values && typeof node.widgets_values === 'object' ? node.widgets_values : {};
  current.video = remotePath;
  if (current.videopreview && typeof current.videopreview === 'object') {
    current.videopreview.params = {
      ...(current.videopreview.params || {}),
      filename: remotePath,
      type: 'input',
      value: remotePath,
      url: undefined
    };
  }
  node.widgets_values = current;
};

export const injectWanWorkflowInputs = ({ workflow, definition, uploadedInputs }) => {
  if (!workflow || !Array.isArray(workflow.nodes)) {
    throw new ComfyUiError('Wan 后端工作流文件无效', { code: 'WORKFLOW_INVALID' });
  }
  if (!definition || definition.engine !== 'wan-video-process') {
    throw new ComfyUiError('当前模板不是 Wan 视频处理工作流', { code: 'WORKFLOW_ENGINE_MISMATCH' });
  }
  const byRole = new Map((Array.isArray(uploadedInputs) ? uploadedInputs : []).map((input) => [input.role, input]));
  const result = cloneJson(workflow);
  const nodesById = new Map(result.nodes.map((node) => [String(node?.id), node]));

  for (const contract of definition.inputs) {
    const input = byRole.get(contract.role);
    if (!input?.remotePath) {
      throw new ComfyUiError(`缺少 Wan 输入：${contract.label}`, { code: 'WORKFLOW_INPUT_MISSING' });
    }
    if (input.kind !== contract.kind) {
      throw new ComfyUiError(`Wan 输入“${contract.label}”素材类型不正确`, { code: 'WORKFLOW_INPUT_TYPE_INVALID' });
    }
    const node = nodesById.get(String(contract.backendNodeId));
    if (!node) {
      throw new ComfyUiError(`Wan 工作流缺少输入节点 ${contract.backendNodeId}`, { code: 'WORKFLOW_INPUT_NODE_MISSING' });
    }
    if (contract.kind === 'image') setLoadImageValue(node, input.remotePath);
    else if (contract.kind === 'video') setLoadVideoValue(node, input.remotePath);
  }
  return result;
};
