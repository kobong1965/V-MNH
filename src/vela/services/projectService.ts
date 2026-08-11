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
  thumbnailUrl?: string;
}

export interface VelaProjectMedia {
  id: string;
  projectId: string;
  kind: 'image' | 'video';
  mime: string;
  bytes: number;
  url: string;
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

export const renameVelaProject = async (projectId: string, name: string): Promise<VelaProjectDocument> =>
  parseResponse<VelaProjectDocument>(await fetch(`/api/vela/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }));

export const deleteVelaProject = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/vela/projects/${projectId}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败：${response.status}`);
  }
};

const encodeFileAsBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
};

const safePackageName = (value: string) => {
  const normalized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
  return normalized || 'Vela-项目';
};

export const exportVelaProjectPackage = async (projectId: string, projectName: string): Promise<void> => {
  const response = await fetch(`/api/vela/projects/${projectId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeMedia: true, download: true })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `分享包导出失败：${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${safePackageName(projectName)}.vela`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export const importVelaProjectPackage = async (file: File): Promise<VelaProjectDocument> =>
  parseResponse<VelaProjectDocument>(await fetch('/api/vela/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageBase64: await encodeFileAsBase64(file) })
  }));

export const saveVelaProjectMedia = async (
  projectId: string,
  input: { data: string; fileName: string }
): Promise<VelaProjectMedia> =>
  parseResponse<VelaProjectMedia>(await fetch(`/api/vela/projects/${projectId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));
