export type VelaJobStatus =
  | 'queued' | 'submitting' | 'running' | 'reconnecting'
  | 'downloading' | 'succeeded' | 'failed' | 'cancelled';

export interface VelaJob {
  id: string;
  groupId: string;
  projectId: string;
  nodeId: string;
  providerType: string;
  profileId: string;
  status: VelaJobStatus;
  payload: Record<string, unknown>;
  progress: number | null;
  seed: number;
  retryCount: number;
  promptId: string | null;
  workflowVersion: string | null;
  error: { message?: string } | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `任务请求失败：${response.status}`);
  return data as T;
};

export const listVelaJobs = async (): Promise<VelaJob[]> =>
  parseResponse<VelaJob[]>(await fetch('/api/vela/jobs?limit=500'));

export const createVelaJobGroup = async (input: {
  projectId: string;
  nodeId: string;
  profileId: string;
  providerType: string;
  payload: Record<string, unknown>;
  count: number;
  seedMode: 'fixed' | 'increment' | 'random';
  seed: number;
}) => parseResponse<{ group: { id: string }; jobs: VelaJob[] }>(await fetch('/api/vela/jobs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input)
}));

export const retryVelaJob = async (jobId: string): Promise<VelaJob> =>
  parseResponse<VelaJob>(await fetch(`/api/vela/jobs/${jobId}/retry`, { method: 'POST' }));

export const cancelVelaJob = async (jobId: string): Promise<VelaJob> =>
  parseResponse<VelaJob>(await fetch(`/api/vela/jobs/${jobId}/cancel`, { method: 'POST' }));
