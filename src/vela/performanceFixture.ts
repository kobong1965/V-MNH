import { NodeStatus, NodeType, type NodeData } from '../types';
import type { VelaNodeKind } from './nodeCatalog';

const KINDS: readonly VelaNodeKind[] = ['prompt', 'gpt-image', 'h3-video'];

export function createVelaPerformanceFixture(count = 200): NodeData[] {
  return Array.from({ length: count }, (_, index) => {
    const kind = KINDS[index % KINDS.length];
    const column = index % 20;
    const row = Math.floor(index / 20);
    const previousId = index > 0 ? `fixture-${index - 1}` : undefined;

    return {
      id: `fixture-${index}`,
      type: kind === 'prompt' ? NodeType.TEXT : kind === 'h3-video' ? NodeType.VIDEO : NodeType.IMAGE,
      kind,
      title: kind === 'prompt' ? '提示词' : kind === 'h3-video' ? 'H3 视频' : 'GPT 图片',
      x: 160 + column * 410,
      y: 120 + row * 260,
      prompt: `性能节点 ${index + 1}`,
      status: NodeStatus.IDLE,
      model: kind === 'h3-video' ? 'H3 ComfyUI' : kind === 'gpt-image' ? 'GPT Image' : 'Text',
      parentIds: previousId ? [previousId] : [],
      aspectRatio: '16:9',
      resolution: 'Auto',
      outputCount: 1,
      imageModel: kind === 'gpt-image' ? 'gpt-image-1.5' : undefined,
      videoModel: kind === 'h3-video' ? 'h3-comfy' : undefined
    };
  });
}
