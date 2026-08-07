interface VelaProfileBase {
  id: string;
  type: 'gpt' | 'comfy';
  name: string;
  baseUrl: string;
  timeoutMs: number;
  maxConcurrency: number;
  secretConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GptVelaProfile extends VelaProfileBase {
  type: 'gpt';
  authType: 'bearer';
  models: { prompt: string; image: string };
}

export type ComfyAuthType = 'none' | 'bearer' | 'basic' | 'custom';
export type ComfyPlatform = 'generic' | 'autodl' | 'runpod';

export interface ComfyVelaProfile extends VelaProfileBase {
  type: 'comfy';
  platform: ComfyPlatform;
  websocketUrl: string;
  authType: ComfyAuthType;
  customHeaderNames: string[];
  workflowVersion: string;
  tags: string[];
  notes: string;
  retentionNote: string;
}

export type VelaProfile = GptVelaProfile | ComfyVelaProfile;

export interface GptConnectionResult {
  ok: true;
  baseUrl: string;
  models: string[];
  checkedAt: string;
}

export interface ComfyConnectionResult {
  ok: true;
  type: 'comfy';
  state: 'online-idle' | 'online-busy' | 'queue-full';
  baseUrl: string;
  websocketUrl: string;
  websocket?: { ok: boolean; url: string };
  http?: { systemStats: boolean; queue: boolean };
  system: {
    os?: string | null;
    pythonVersion?: string | null;
    deviceCount?: number;
    gpu: null | {
      name: string;
      type?: string | null;
      vramTotal: number;
      vramFree: number;
      torchVramTotal?: number;
      torchVramFree?: number;
    };
  };
  queue: {
    running: number;
    pending: number;
    total: number;
    maxConcurrency: number;
    full: boolean;
  };
  checkedAt: string;
}

export type ProfileConnectionResult = GptConnectionResult | ComfyConnectionResult;

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `账户请求失败：${response.status}`);
  return data as T;
};

export const listVelaProfiles = async (type?: 'gpt' | 'comfy'): Promise<VelaProfile[]> =>
  parseResponse<VelaProfile[]>(await fetch(`/api/vela/profiles${type ? `?type=${type}` : ''}`));

export const createVelaProfile = async (input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { prompt: string; image: string };
  timeoutMs?: number;
  maxConcurrency?: number;
}): Promise<GptVelaProfile> => parseResponse<GptVelaProfile>(await fetch('/api/vela/profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'gpt', ...input })
}));

export interface CreateComfyProfileInput {
  name: string;
  platform: ComfyPlatform;
  baseUrl: string;
  websocketUrl?: string;
  authType: ComfyAuthType;
  token?: string;
  username?: string;
  password?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxConcurrency?: number;
  workflowVersion?: string;
  tags?: string[];
  notes?: string;
  retentionNote?: string;
}

export const createComfyProfile = async (input: CreateComfyProfileInput): Promise<ComfyVelaProfile> =>
  parseResponse<ComfyVelaProfile>(await fetch('/api/vela/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'comfy', ...input })
  }));

export const updateVelaProfile = async (
  id: string,
  patch: Record<string, unknown>
): Promise<VelaProfile> => parseResponse<VelaProfile>(await fetch(`/api/vela/profiles/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(patch)
}));

export const deleteVelaProfile = async (id: string): Promise<void> => {
  const response = await fetch(`/api/vela/profiles/${id}`, { method: 'DELETE' });
  if (!response.ok) await parseResponse(response);
};

export const testVelaProfile = async (id: string): Promise<ProfileConnectionResult> =>
  parseResponse<ProfileConnectionResult>(await fetch(`/api/vela/profiles/${id}/test`, { method: 'POST' }));

export const getComfyProfileStatus = async (id: string): Promise<ComfyConnectionResult> =>
  parseResponse<ComfyConnectionResult>(await fetch(`/api/vela/comfy/${id}/status`));
