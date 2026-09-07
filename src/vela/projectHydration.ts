import type { NodeData } from '../types';

const INTERRUPTED_UPLOAD_MESSAGE = '上传已中断，请重新上传或把原文件再次拖入画布。';

export const hydrateLoadedVelaNode = (node: NodeData): NodeData => {
  if (node.status !== 'loading' || node.uploadSource !== 'canvas-drop') return node;
  return {
    ...node,
    status: 'error' as NodeData['status'],
    uploadProgress: undefined,
    errorMessage: INTERRUPTED_UPLOAD_MESSAGE
  };
};
