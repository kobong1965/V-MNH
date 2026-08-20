export interface VelaCloudRepositoryItem {
  id: string;
  name: string;
  status: string;
  sizeBytes: number;
  createdAt: string | null;
}

export interface VelaCloudAccountOverview {
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
  repository?: {
    total: number;
    items: VelaCloudRepositoryItem[];
  } | null;
  warnings?: string[];
  updatedAt?: string;
}

export async function getVelaCloudAccountOverview(): Promise<VelaCloudAccountOverview> {
  const response = await fetch('/api/vela/cloud-account');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `云账户请求失败：${response.status}`);
  return data as VelaCloudAccountOverview;
}
