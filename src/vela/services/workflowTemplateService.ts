import type { NodeData, NodeGroup, Viewport } from '../../types';

export interface VelaWorkflowTemplateSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  assetCount: number;
}

export interface VelaWorkflowTemplate extends Omit<VelaWorkflowTemplateSummary, 'nodeCount' | 'assetCount'> {
  schemaVersion: number;
  nodes: NodeData[];
  groups: NodeGroup[];
  assets?: Array<{ id: string; kind: 'image' | 'video'; mime: string; bytes: number }>;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
};

export const listVelaWorkflowTemplates = async () =>
  parseResponse<VelaWorkflowTemplateSummary[]>(await fetch('/api/vela/workflows'));

export const getVelaWorkflowTemplate = async (id: string) =>
  parseResponse<VelaWorkflowTemplate>(await fetch(`/api/vela/workflows/${id}`));

export const saveVelaWorkflowTemplate = async (input: { name: string; projectId: string; nodes: NodeData[]; groups: NodeGroup[] }) =>
  parseResponse<VelaWorkflowTemplate>(await fetch('/api/vela/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));

export const instantiateVelaWorkflowTemplate = async (id: string, projectId: string) =>
  parseResponse<VelaWorkflowTemplate>(await fetch(`/api/vela/workflows/${id}/instantiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  }));

export const deleteVelaWorkflowTemplate = async (id: string) => {
  const response = await fetch(`/api/vela/workflows/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `请求失败：${response.status}`);
};

export const instantiateWorkflowTemplate = (
  template: VelaWorkflowTemplate,
  viewport: Viewport,
  screenSize: { width: number; height: number }
): { nodes: NodeData[]; groups: NodeGroup[] } => {
  const nodeIdMap = new Map<string, string>(template.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const groupIdMap = new Map<string, string>(template.groups.map((group) => [group.id, crypto.randomUUID()]));
  const minX = template.nodes.length > 0 ? Math.min(...template.nodes.map((node) => node.x)) : 0;
  const minY = template.nodes.length > 0 ? Math.min(...template.nodes.map((node) => node.y)) : 0;
  const targetX = (screenSize.width * 0.32 - viewport.x) / viewport.zoom;
  const targetY = (screenSize.height * 0.22 - viewport.y) / viewport.zoom;
  const offsetX = targetX - minX;
  const offsetY = targetY - minY;
  const nodes = template.nodes.map((node) => ({
    ...node,
    id: nodeIdMap.get(node.id)!,
    x: node.x + offsetX,
    y: node.y + offsetY,
    parentIds: (node.parentIds || []).map((id) => nodeIdMap.get(id)).filter((id): id is string => Boolean(id)),
    groupId: node.groupId ? groupIdMap.get(node.groupId) : undefined,
    frameInputs: node.frameInputs?.map((input) => ({ ...input, nodeId: nodeIdMap.get(input.nodeId) || input.nodeId }))
  }));
  const groups = template.groups.map((group) => ({
    ...group,
    id: groupIdMap.get(group.id)!,
    nodeIds: group.nodeIds.map((id) => nodeIdMap.get(id)).filter((id): id is string => Boolean(id))
  }));
  return { nodes, groups };
};
