export type BatchWorkflowItemStatus = 'draft' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BatchWorkflowItem {
  id: string;
  index: number;
  sourceName: string;
  projectId: string;
  projectName: string;
  workflowName?: string;
  groupId?: string;
  inputNodeId: string;
  benchmarkNodeId?: string | null;
  generationNodeId: string;
  poseNodeId?: string | null;
  sourceUrl: string;
  benchmarkUrl?: string | null;
  jobGroupId: string | null;
  status: BatchWorkflowItemStatus;
  progress: number;
  outputs: Array<{ jobId: string; url: string }>;
}

export interface BatchWorkflow {
  id: string;
  name: string;
  projectId?: string;
  projectName?: string;
  prompt: string;
  profileId: string;
  profileName: string;
  imageModel: string;
  aspectRatio: string;
  resolution: string;
  outputCount: number;
  benchmark?: null | { name: string; url: string };
  poseVariation?: { enabled: boolean; prompt?: string; outputCount?: number };
  createdAt: string;
  updatedAt: string;
  sync: null | { target: 'storyworks'; syncedAt: string };
  lastSync?: null | {
    syncedAt: string;
    targets: Array<{ id: string; name: string; kind: 'built-in' | 'paired'; status: 'succeeded' | 'failed'; error?: string }>;
  };
  items: BatchWorkflowItem[];
}

export interface BatchSyncTargetResult {
  id: string;
  name: string;
  kind: 'built-in' | 'paired';
  status: 'succeeded' | 'failed';
  syncedAt: string;
  manifestUrl?: string;
  error?: string;
}

export interface BatchSyncResult {
  batchId: string;
  target: string;
  syncedAt: string;
  manifestUrl: string;
  targets: BatchSyncTargetResult[];
}

export interface CreateBatchWorkflowInput {
  name: string;
  prompt: string;
  profileId: string;
  aspectRatio: string;
  resolution: string;
  outputCount: number;
  images: Array<{ name: string; data: string }>;
  benchmarkImage?: { name: string; data: string } | null;
  poseVariation: { enabled: boolean; prompt: string; outputCount: number };
}

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  effectImage?: {
    name: string;
    mime: 'image/png' | 'image/jpeg' | 'image/webp';
    bytes: number;
    url: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BatchPromptAnalysisInput {
  profileId: string;
  modelSlot: 'prompt' | 'analysis';
  requirement: string;
  productImages: Array<{ name: string; data: string }>;
  benchmarkImage?: { name: string; data: string } | null;
}

export interface BatchPromptAnalysisResult {
  text: string;
  source: {
    provider: 'openai-compatible';
    profileId: string;
    model: string;
    modelSlot: 'prompt' | 'analysis';
  };
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `批量工作流请求失败：${response.status}`);
  return data as T;
};

export const listBatchWorkflows = async (): Promise<BatchWorkflow[]> =>
  parseResponse<BatchWorkflow[]>(await fetch('/api/vela/batches'));

export const getBatchWorkflow = async (batchId: string): Promise<BatchWorkflow> =>
  parseResponse<BatchWorkflow>(await fetch(`/api/vela/batches/${batchId}`));

export const createBatchWorkflow = async (input: CreateBatchWorkflowInput): Promise<BatchWorkflow> =>
  parseResponse<BatchWorkflow>(await fetch('/api/vela/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));

export const startBatchWorkflow = async (batchId: string, itemIds: string[]) =>
  parseResponse<{ batch: BatchWorkflow; started: number; skipped: number; errors: Array<{ itemId: string; message: string }> }>(
    await fetch(`/api/vela/batches/${batchId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds })
    })
  );

export const syncBatchWorkflow = async (batchId: string, targetIds: string[]): Promise<BatchSyncResult> => parseResponse(await fetch(`/api/vela/batches/${batchId}/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ targetIds })
}));

export const analyzeBatchPrompt = async (input: BatchPromptAnalysisInput): Promise<BatchPromptAnalysisResult> =>
  parseResponse<BatchPromptAnalysisResult>(await fetch('/api/vela/prompt-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));

export const listPromptTemplates = async (): Promise<PromptTemplate[]> =>
  parseResponse<PromptTemplate[]>(await fetch('/api/vela/prompt-templates'));

export const savePromptTemplate = async (input: {
  name: string;
  text: string;
  effectImage?: { name: string; data: string };
}): Promise<PromptTemplate> =>
  parseResponse<PromptTemplate>(await fetch('/api/vela/prompt-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }));

export const deletePromptTemplate = async (id: string): Promise<void> => {
  const response = await fetch(`/api/vela/prompt-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) await parseResponse(response);
};
