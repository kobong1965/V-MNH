import type { VelaProjectDocument } from './projectService';

export interface EcommerceWorkflowPreviewNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}

export interface EcommerceWorkflowPreview {
  bounds: { x: number; y: number; width: number; height: number };
  nodes: EcommerceWorkflowPreviewNode[];
  links: Array<{ from: string; to: string }>;
}

export interface EcommerceWorkflowSummary {
  id: string;
  name: string;
  category: 'video' | 'portrait' | 'restore' | 'commerce' | 'outfit';
  categoryLabel: string;
  description: string;
  engine: 'gpt-image' | 'wan-video-process';
  engineLabel: string;
  inputCount: number;
  nodeCount: number;
  linkCount: number;
  backendNodeCount: number;
  backendLinkCount: number;
  groupCount: number;
  sourceHash: string;
  preview: EcommerceWorkflowPreview;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
};

export const listEcommerceWorkflows = async (): Promise<EcommerceWorkflowSummary[]> =>
  parseResponse<EcommerceWorkflowSummary[]>(await fetch('/api/vela/ecommerce-workflows'));

export const createEcommerceWorkflowProject = async (workflowId: string): Promise<VelaProjectDocument> =>
  parseResponse<VelaProjectDocument>(await fetch(`/api/vela/ecommerce-workflows/${encodeURIComponent(workflowId)}/instantiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }));

export const deleteEcommerceWorkflow = async (workflowId: string): Promise<void> => {
  const response = await fetch(`/api/vela/ecommerce-workflows/${encodeURIComponent(workflowId)}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `删除失败：${response.status}`);
  }
};
