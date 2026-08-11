interface VelaProfileBase {
  id: string;
  type: 'gpt' | 'comfy';
  name: string;
  baseUrl: string;
  timeoutMs: number;
  maxConcurrency: number;
  secretConfigured: boolean;
  credentialStatus?: 'ready' | 'missing' | 'unreadable';
  createdAt: string;
  updatedAt: string;
}

export interface GptVelaProfile extends VelaProfileBase {
  type: 'gpt';
  authType: 'bearer';
  provider: string;
  models: { prompt: string; image: string; video: string };
  endpoints: {
    models: string;
    chat: string;
    imageGeneration: string;
    imageEdit: string;
    videoGeneration: string;
    videoStatus: string;
  };
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

export const DEFAULT_GPT_ENDPOINTS: GptVelaProfile['endpoints'] = {
  models: '/models',
  chat: '/chat/completions',
  imageGeneration: '/images/generations',
  imageEdit: '/images/edits',
  videoGeneration: '/videos/generations',
  videoStatus: '/videos/{id}'
};

export const normalizeGptVelaProfile = (profile: GptVelaProfile): GptVelaProfile => ({
  ...profile,
  authType: profile.authType || 'bearer',
  provider: profile.provider || 'OpenAI Compatible',
  models: {
    prompt: '',
    image: '',
    video: '',
    ...(profile.models || {})
  },
  endpoints: {
    ...DEFAULT_GPT_ENDPOINTS,
    ...(profile.endpoints || {})
  },
  timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : 60_000,
  maxConcurrency: Number.isFinite(profile.maxConcurrency) ? profile.maxConcurrency : 2
});

const normalizeVelaProfile = (profile: VelaProfile): VelaProfile =>
  profile.type === 'gpt' ? normalizeGptVelaProfile(profile) : profile;

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

export interface VelaProfileErrorDetails {
  missingModels?: string[];
  availableModels?: string[];
  networkCode?: string;
  endpointHost?: string;
}

export class VelaProfileRequestError extends Error {
  code?: string;
  details?: VelaProfileErrorDetails;

  constructor(message: string, data?: { code?: string; details?: VelaProfileErrorDetails }) {
    super(message);
    this.name = 'VelaProfileRequestError';
    this.code = data?.code;
    this.details = data?.details;
  }
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VelaProfileRequestError(data.error || `账户请求失败：${response.status}`, {
      code: data.code,
      details: data.details
    });
  }
  return data as T;
};

export const listVelaProfiles = async (type?: 'gpt' | 'comfy'): Promise<VelaProfile[]> => {
  const profiles = await parseResponse<VelaProfile[]>(await fetch(`/api/vela/profiles${type ? `?type=${type}` : ''}`));
  if (!Array.isArray(profiles)) throw new Error('账户列表返回格式不正确');
  return profiles.map(normalizeVelaProfile);
};

export const createVelaProfile = async (input: {
  name: string;
  provider?: string;
  baseUrl: string;
  apiKey: string;
  models: { prompt: string; image: string; video?: string };
  endpoints?: Partial<GptVelaProfile['endpoints']>;
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
