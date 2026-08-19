export interface VelaDashboardBucket {
  key: string;
  successfulVideos: number;
  failedVideos: number;
  activeVideos: number;
  generatedSeconds: number;
  gpuSeconds: number;
  estimatedCostYuan: number;
}

export interface VelaDataDashboardOverview {
  generatedAt: string;
  date: string;
  timezone: 'Asia/Shanghai';
  hourlyRateYuan: number;
  account: {
    configured: boolean;
    provider: 'autodl';
    profileId?: string;
    profileName?: string;
    message?: string;
    balance?: {
      availableYuan: number;
      voucherYuan: number;
      accumulatedYuan: number;
    } | null;
    warnings: string[];
    updatedAt?: string;
  };
  summary: {
    successfulVideos: number;
    failedVideos: number;
    activeVideos: number;
    generatedSeconds: number;
    gpuSeconds: number;
    estimatedCostYuan: number;
    successfulCostYuan: number;
    failedCostYuan: number;
    activeCostYuan: number;
  };
  byResolution: VelaDashboardBucket[];
  byPreset: VelaDashboardBucket[];
}

export async function fetchVelaDataDashboard(): Promise<VelaDataDashboardOverview> {
  const response = await fetch('/api/vela/data-dashboard');
  const body = await response.json().catch(() => null) as (VelaDataDashboardOverview & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `数据台加载失败（HTTP ${response.status}）`);
  if (!body) throw new Error('数据台返回了空响应');
  return body;
}
