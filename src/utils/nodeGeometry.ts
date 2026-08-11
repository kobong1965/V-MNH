import { NodeData, NodeStatus, NodeType } from '../types';

const parseRatio = (value?: string, separator = '/'): number | null => {
  if (!value) return null;
  const [width, height] = value.split(separator).map(Number);
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
};

const RESULT_COLLECTION_BASE_WIDTH = 656;
const RESULT_COLLECTION_ITEM_WIDTH = 252;
const RESULT_COLLECTION_GAP = 8;

export const getResultCollectionCount = (node: NodeData): number => {
  const count = node.resultUrls?.filter(Boolean).length || 0;
  return Math.max(1, count);
};

export const isResultCollectionExpanded = (node: NodeData): boolean => (
  Boolean(node.resultCollectionExpanded)
  && getResultCollectionCount(node) > 1
  && node.type === NodeType.IMAGE
);

export const getResultCollectionWidth = (node: NodeData): number => {
  if (!isResultCollectionExpanded(node)) return RESULT_COLLECTION_BASE_WIDTH;
  const count = getResultCollectionCount(node);
  return Math.max(
    RESULT_COLLECTION_BASE_WIDTH,
    count * RESULT_COLLECTION_ITEM_WIDTH + (count - 1) * RESULT_COLLECTION_GAP
  );
};

export const getCanvasNodeWidth = (node: NodeData, parentNode?: NodeData): number => {
  if (node.kind) {
    if (['prompt', 'gpt-prompt-optimizer'].includes(node.kind)) return 370;
    return getResultCollectionWidth(node);
  }
  if (node.type === NodeType.IMAGE_EDITOR) {
    const ratio = parentNode?.status === NodeStatus.SUCCESS && parentNode.resultUrl
      ? parseRatio(parentNode.resultAspectRatio)
      : null;
    return ratio ? Math.min(500, 500 * ratio) : 340;
  }
  if (node.type === NodeType.VIDEO_EDITOR) {
    return parentNode?.status === NodeStatus.SUCCESS && parentNode.resultUrl ? 500 : 340;
  }
  if (node.type === NodeType.VIDEO) return 385;
  if (node.type === NodeType.CAMERA_ANGLE) return 340;
  return 365;
};

export const getCanvasNodeHeight = (node: NodeData, parentNode?: NodeData): number => {
  const width = getCanvasNodeWidth(node, parentNode);
  const hasContent = node.status === NodeStatus.SUCCESS && Boolean(node.resultUrl);
  if (node.kind) {
    const ratio = hasContent ? parseRatio(node.resultAspectRatio) : null;
    if (ratio && isResultCollectionExpanded(node)) {
      const count = getResultCollectionCount(node);
      const itemWidth = (width - (count - 1) * RESULT_COLLECTION_GAP) / count;
      return itemWidth / ratio;
    }
    return ratio ? width / ratio : 370;
  }
  if (node.type === NodeType.IMAGE_EDITOR) {
    const ratio = parentNode?.status === NodeStatus.SUCCESS && parentNode.resultUrl
      ? parseRatio(parentNode.resultAspectRatio)
      : null;
    if (!ratio) return 380;
    return ratio < 1 ? 500 : 500 / ratio;
  }
  if (node.type === NodeType.VIDEO_EDITOR) {
    return parentNode?.status === NodeStatus.SUCCESS && parentNode.resultUrl ? 500 / (16 / 9) : 380;
  }
  if (node.type === NodeType.CAMERA_ANGLE) {
    const ratio = hasContent ? parseRatio(node.resultAspectRatio) : null;
    return ratio ? 340 / ratio : 340;
  }
  const ratio = hasContent
    ? parseRatio(node.resultAspectRatio) || parseRatio(node.aspectRatio, ':')
    : null;
  return width / (ratio || 4 / 3);
};

export const getCanvasNodeBounds = (node: NodeData, nodes: NodeData[] = []) => {
  const parent = node.parentIds?.[0] ? nodes.find((candidate) => candidate.id === node.parentIds?.[0]) : undefined;
  const width = getCanvasNodeWidth(node, parent);
  const height = getCanvasNodeHeight(node, parent);
  return { left: node.x, top: node.y, right: node.x + width, bottom: node.y + height, width, height };
};
