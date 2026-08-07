import type { NodeData, NodeGroup, Viewport } from '../../types';

export interface VelaProjectDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
  settings?: Record<string, unknown>;
}

export interface VelaProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
};

export const saveVelaProject = async (project: {
  id?: string | null;
  name: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
}): Promise<VelaProjectDocument> => {
  const id = project.id || undefined;
  const response = await fetch(id ? `/api/vela/projects/${id}` : '/api/vela/projects', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...project, id })
  });
  return parseResponse<VelaProjectDocument>(response);
};

export const loadVelaProject = async (projectId: string): Promise<VelaProjectDocument> =>
  parseResponse<VelaProjectDocument>(await fetch(`/api/vela/projects/${projectId}`));

export const listVelaProjects = async (): Promise<VelaProjectSummary[]> =>
  parseResponse<VelaProjectSummary[]>(await fetch('/api/vela/projects'));
