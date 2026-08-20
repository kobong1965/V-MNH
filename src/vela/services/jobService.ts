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
  error: {
    code?: string;
    status?: number;
    message?: string;
    retryable?: boolean;
    safeToRetry?: boolean;
    details?: {
      networkCode?: string;
      networkMessage?: string;
      endpointHost?: string;
      profileName?: string;
      model?: string;
      modelType?: string;
      taskId?: string;
      missingModels?: string[];
      availableModels?: string[];
    };
  } | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const getVelaJobErrorMessage = (error: VelaJob['error']): string => {
  if (!error) return '生成失败，请重试。';
  const message = String(error.message || '').trim();
  const account = error.details?.profileName ? `“${error.details.profileName}”` : '当前账户';
  const host = error.details?.endpointHost || '中转站';
  const networkCode = error.details?.networkCode;

  if (error.code === 'MODEL_NOT_FOUND') {
    return message || `${account}配置的模型已不在中转站模型列表中，请到 API 设置重新测试并更换模型或账户。`;
  }
  if (error.code === 'MODEL_NOT_CONFIGURED') {
    return message || `${account}尚未配置此任务需要的模型。`;
  }
  if (error.code === 'AUTH_FAILED') {
    return `${account}鉴权失败，请检查 API Key 是否失效或余额账户是否被冻结。`;
  }
  if (error.code === 'CREDENTIAL_UNREADABLE') {
    return `${account}的本机加密密钥无法解密，请到 API 设置重新输入 API Key 并保存。`;
  }
  if (error.code === 'CREDENTIAL_MISSING') {
    return `${account}尚未保存 API Key，请到 API 设置补充。`;
  }
  if (error.code === 'RATE_LIMITED') {
    return `${host}当前限流，请稍后重试或降低并发数。`;
  }

  if (error.code === 'PROVIDER_UNAVAILABLE') {
    return `${host}或其上游模型暂时不可用，请稍后重试。`;
  }
  if (error.code === 'TIMEOUT') {
    return `等待 ${host} 响应超时。为避免重复扣费，未知结果的生成任务不会自动重复提交。`;
  }
  if (error.code === 'VIDEO_POLL_TIMEOUT') {
    return `视频任务仍未完成，远端任务 ID 为 ${error.details?.taskId || '未知'}。软件没有重复提交，可稍后重试查询。`;
  }
  if (error.code === 'VIDEO_TASK_FAILED') {
    return message || `${host} 返回视频任务失败，请按上游原因修改提示词、参考图或账户配置。`;
  }
  if (error.code === 'RESULT_DOWNLOAD_FAILED') {
    return '模型已经返回结果，但软件下载媒体文件时失败；可直接重试，软件会自动重试下载连接。';
  }
  if (['SSH_TUNNEL_FAILED', 'SSH_TUNNEL_TIMEOUT', 'REMOTE_START_FAILED', 'REMOTE_START_TIMEOUT'].includes(error.code || '')) {
    return message || '无法连接 AutoDL 实例或启动远端 ComfyUI，请确认实例处于“运行中”状态。';
  }
  if (error.code === 'PROMPT_TIMEOUT') {
    return 'ComfyUI 任务仍在云端运行，远端任务 ID 已保留。点击重试只会继续查询，不会重复提交。';
  }
  if (error.code === 'PROMPT_REJECTED') {
    return message || 'ComfyUI 拒绝了工作流，请检查模型文件和节点是否完整。';
  }
  if (error.code === 'EXECUTION_FAILED') {
    return message || 'ComfyUI 执行工作流失败，请按节点返回的原因检查显存、模型或输入参数。';
  }
  if (error.code === 'OUTPUT_NOT_FOUND') {
    return 'ComfyUI 工作流已结束，但没有找到可下载的视频文件；远端任务 ID 已保留。';
  }
  if (error.code === 'WORKFLOW_CONVERTER_MISSING') {
    return message || '远端 ComfyUI 缺少工作流转换端点，请按 Wan 云端部署说明安装转换插件后重启。';
  }
  if (error.code === 'COMFY_UNAVAILABLE') {
    return message || '云端 ComfyUI 暂时不可用，请确认 AutoDL 实例与服务状态。';
  }
  if (error.code === 'NETWORK_ERROR') {
    if (networkCode === 'ENOTFOUND' || networkCode === 'EAI_AGAIN') {
      return `${host} 的 DNS 解析失败，请检查本机 DNS 或稍后重试。`;
    }
    if (networkCode === 'UND_ERR_CONNECT_TIMEOUT' || networkCode === 'ETIMEDOUT') {
      return `连接 ${host} 时建立连接超时，软件已自动重试安全的建连阶段。`;
    }
    if (networkCode === 'ECONNREFUSED') {
      return `${host} 拒绝连接，通常是中转站服务未启动或端口不可用。`;
    }
    if (networkCode === 'ECONNRESET' || networkCode === 'UND_ERR_SOCKET') {
      return `${host} 在请求中途断开连接。为避免重复扣费，本次未自动重复提交。`;
    }
    return `与 ${host} 的网络连接失败${networkCode ? `（${networkCode}）` : ''}，请稍后重试。`;
  }
  if (/requires an image model, got/i.test(message)) {
    const configuredModel = message.match(/got\s+["“]?([^"”]+)["”]?/i)?.[1];
    return configuredModel
      ? `图片模型配置错误：${configuredModel} 不是图片生成模型，请在账户设置中更换。`
      : '图片模型配置错误，请在账户设置中选择图片生成模型。';
  }
  if (/fetch failed|network error|failed to fetch/i.test(message)) {
    return `无法连接 ${host}。请先在 API 设置中点击“测试并读取模型”确认中转站状态。`;
  }

  return message || '生成失败，请重试。';
};

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
