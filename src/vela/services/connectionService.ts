export interface VelaConnectionInfo {
  baseUrls: string[];
  pairingCode: string;
  expiresAt: string;
  connectedClients: number;
  lanEnabled: boolean;
  remotePairingRequired: boolean;
}

async function requestConnection(path: string, init?: RequestInit): Promise<VelaConnectionInfo> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `连接服务返回 ${response.status}`);
  return payload as VelaConnectionInfo;
}

export const getVelaConnectionInfo = () => requestConnection('/api/vela/connection');
export const rotateVelaPairingCode = () => requestConnection('/api/vela/connection/rotate', { method: 'POST' });
export const revokeVelaConnections = () => requestConnection('/api/vela/connection/revoke', { method: 'POST' });
