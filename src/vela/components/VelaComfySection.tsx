import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Gauge,
  LoaderCircle,
  Power,
  Plus,
  Save,
  Server,
  Trash2,
  Wifi
} from 'lucide-react';

import {
  createComfyProfile,
  deleteVelaProfile,
  testCloudPower,
  testVelaProfile,
  updateVelaProfile,
  type CloudPowerTestResult,
  type ComfyAuthType,
  type ComfyConnectionResult,
  type ComfyPlatform,
  type ComfyTransport,
  type ComfyVelaProfile
} from '../services/profileService';

interface VelaComfySectionProps {
  profiles: ComfyVelaProfile[];
  onProfilesChanged: () => void | Promise<unknown>;
  onMessage: (message: string | null) => void;
  showHeading?: boolean;
}

interface ComfyFormState {
  name: string;
  platform: ComfyPlatform;
  baseUrl: string;
  websocketUrl: string;
  transport: ComfyTransport;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKeyPath: string;
  sshLocalPort: number;
  sshRemoteHost: string;
  sshRemotePort: number;
  sshStartScript: string;
  autoPowerEnabled: boolean;
  autodlInstanceUuid: string;
  autodlDeveloperToken: string;
  idleShutdownMinutes: number;
  powerOnTimeoutMinutes: number;
  authType: ComfyAuthType;
  token: string;
  username: string;
  password: string;
  customHeaderName: string;
  customHeaderValue: string;
  maxConcurrency: number;
  workflowVersion: string;
  notes: string;
}

const INITIAL_FORM: ComfyFormState = {
  name: 'AutoDL H3 算力',
  platform: 'autodl',
  baseUrl: 'http://127.0.0.1:18188',
  websocketUrl: '',
  transport: 'ssh',
  sshHost: 'connect.westd.seetacloud.com',
  sshPort: 23396,
  sshUsername: 'root',
  sshPrivateKeyPath: 'C:\\Users\\Administrator\\.ssh\\vela-autodl-h3',
  sshLocalPort: 18188,
  sshRemoteHost: '127.0.0.1',
  sshRemotePort: 6006,
  sshStartScript: '/root/autodl-tmp/vela-h3/deploy/start-comfy.sh',
  autoPowerEnabled: false,
  autodlInstanceUuid: '',
  autodlDeveloperToken: '',
  idleShutdownMinutes: 5,
  powerOnTimeoutMinutes: 10,
  authType: 'none',
  token: '',
  username: '',
  password: '',
  customHeaderName: 'x-api-key',
  customHeaderValue: '',
  maxConcurrency: 1,
  workflowVersion: 'minimax-h3-v1',
  notes: ''
};

const stateLabels: Record<ComfyConnectionResult['state'], string> = {
  'online-idle': '在线 · 空闲',
  'online-busy': '在线 · 运行中',
  'queue-full': '在线 · 队列已满'
};

const formatVram = (bytes: number) => bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : '未知';

interface AutoPowerDraft {
  enabled: boolean;
  instanceUuid: string;
  developerToken: string;
  idleShutdownMinutes: number;
  powerOnTimeoutMinutes: number;
}

const powerDraftFromProfile = (profile: ComfyVelaProfile): AutoPowerDraft => ({
  enabled: profile.autoPowerEnabled,
  instanceUuid: profile.autodlInstanceUuid,
  developerToken: '',
  idleShutdownMinutes: profile.idleShutdownMinutes || 5,
  powerOnTimeoutMinutes: Math.max(1, Math.round((profile.powerOnTimeoutMs || 600_000) / 60_000))
});

export function VelaComfySection({ profiles, onProfilesChanged, onMessage, showHeading = true }: VelaComfySectionProps) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ComfyConnectionResult>>({});
  const [powerDrafts, setPowerDrafts] = useState<Record<string, AutoPowerDraft>>({});
  const [powerResults, setPowerResults] = useState<Record<string, CloudPowerTestResult>>({});

  const credentialReady = form.authType === 'none'
    || (form.authType === 'bearer' && Boolean(form.token.trim()))
    || (form.authType === 'basic' && Boolean(form.username.trim() && form.password))
    || (form.authType === 'custom' && Boolean(form.customHeaderName.trim() && form.customHeaderValue.trim()));
  const autoPowerReady = !form.autoPowerEnabled
    || Boolean(/^pro-[a-z0-9]+$/i.test(form.autodlInstanceUuid.trim()) && form.autodlDeveloperToken.trim());

  const saveConnection = async () => {
    try {
      setBusyId('new-comfy');
      onMessage(null);
      await createComfyProfile({
        name: form.name,
        platform: form.platform,
        baseUrl: form.baseUrl,
        websocketUrl: form.websocketUrl || undefined,
        transport: form.transport,
        sshHost: form.transport === 'ssh' ? form.sshHost : undefined,
        sshPort: form.transport === 'ssh' ? form.sshPort : undefined,
        sshUsername: form.transport === 'ssh' ? form.sshUsername : undefined,
        sshPrivateKeyPath: form.transport === 'ssh' ? form.sshPrivateKeyPath : undefined,
        sshLocalPort: form.transport === 'ssh' ? form.sshLocalPort : undefined,
        sshRemoteHost: form.transport === 'ssh' ? form.sshRemoteHost : undefined,
        sshRemotePort: form.transport === 'ssh' ? form.sshRemotePort : undefined,
        sshStartScript: form.transport === 'ssh' ? form.sshStartScript : undefined,
        autoPowerEnabled: form.platform === 'autodl' && form.autoPowerEnabled,
        autodlInstanceUuid: form.platform === 'autodl' ? form.autodlInstanceUuid : undefined,
        autodlDeveloperToken: form.platform === 'autodl' ? form.autodlDeveloperToken : undefined,
        idleShutdownMinutes: form.idleShutdownMinutes,
        powerOnTimeoutMs: form.powerOnTimeoutMinutes * 60_000,
        authType: form.authType,
        token: form.authType === 'bearer' ? form.token : undefined,
        username: form.authType === 'basic' ? form.username : undefined,
        password: form.authType === 'basic' ? form.password : undefined,
        customHeaders: form.authType === 'custom'
          ? { [form.customHeaderName]: form.customHeaderValue }
          : undefined,
        maxConcurrency: form.maxConcurrency,
        workflowVersion: form.workflowVersion,
        tags: [form.platform, 'H3'],
        notes: form.notes
      });
      setForm(INITIAL_FORM);
      setIsAdding(false);
      await onProfilesChanged();
      onMessage('云端 ComfyUI 连接已加密保存。点击“全面检测”读取显卡、队列和 WebSocket 状态。');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '保存 ComfyUI 连接失败');
    } finally {
      setBusyId(null);
    }
  };

  const getPowerDraft = (profile: ComfyVelaProfile) => powerDrafts[profile.id] || powerDraftFromProfile(profile);

  const patchPowerDraft = (profile: ComfyVelaProfile, patch: Partial<AutoPowerDraft>) => {
    setPowerDrafts((current) => ({
      ...current,
      [profile.id]: { ...(current[profile.id] || powerDraftFromProfile(profile)), ...patch }
    }));
  };

  const savePowerSettings = async (profile: ComfyVelaProfile) => {
    const draft = getPowerDraft(profile);
    try {
      setBusyId(`power-save-${profile.id}`);
      onMessage(null);
      await updateVelaProfile(profile.id, {
        autoPowerEnabled: draft.enabled,
        autodlInstanceUuid: draft.instanceUuid,
        idleShutdownMinutes: draft.idleShutdownMinutes,
        powerOnTimeoutMs: draft.powerOnTimeoutMinutes * 60_000,
        ...(draft.developerToken.trim() ? { autodlDeveloperToken: draft.developerToken.trim() } : {})
      });
      setPowerDrafts((current) => ({
        ...current,
        [profile.id]: { ...draft, developerToken: '' }
      }));
      await onProfilesChanged();
      onMessage(draft.enabled
        ? 'AutoDL Pro 自动开关机已启用：新任务会自动开机，空闲后自动关机。'
        : 'AutoDL 自动开关机已关闭。');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '保存 AutoDL 自动开关机设置失败');
    } finally {
      setBusyId(null);
    }
  };

  const testPowerConnection = async (profile: ComfyVelaProfile) => {
    try {
      setBusyId(`power-test-${profile.id}`);
      onMessage(null);
      const result = await testCloudPower(profile.id);
      setPowerResults((current) => ({ ...current, [profile.id]: result }));
      onMessage(`AutoDL Pro 控制接口正常，实例当前状态：${result.remoteState}`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'AutoDL Pro 控制接口检测失败');
    } finally {
      setBusyId(null);
    }
  };

  const testConnection = async (profile: ComfyVelaProfile) => {
    try {
      setBusyId(profile.id);
      onMessage(null);
      const result = await testVelaProfile(profile.id);
      if (!('type' in result) || result.type !== 'comfy') throw new Error('连接返回的数据类型不正确');
      setResults((current) => ({ ...current, [profile.id]: result }));
      const gpuName = result.system.gpu?.name || '未识别显卡';
      onMessage(`ComfyUI 已连接：${gpuName}，运行 ${result.queue.running}，排队 ${result.queue.pending}。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'ComfyUI 连接检测失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="vela-connection-section vela-comfy-section" {...(showHeading ? { 'aria-labelledby': 'comfy-section-title' } : { 'aria-label': '云端 ComfyUI 连接' })}>
      {showHeading && <div className="vela-section-title" id="comfy-section-title">
        <Cloud size={15} aria-hidden="true" /> 云端 ComfyUI
        <button className="vela-button vela-compact-button" type="button" onClick={() => setIsAdding((current) => !current)}>
          <Plus size={13} aria-hidden="true" /> {isAdding ? '收起' : '添加算力'}
        </button>
      </div>}

      {profiles.length === 0 && !isAdding && (
        <div className="vela-comfy-empty" role="status">
          <Server size={18} aria-hidden="true" />
          <span>尚未配置云端算力。租好实例并启动 ComfyUI 后，在这里填写访问地址。</span>
        </div>
      )}

      {profiles.map((profile) => {
        const result = results[profile.id];
        const powerDraft = getPowerDraft(profile);
        const powerResult = powerResults[profile.id];
        const powerDraftReady = !powerDraft.enabled || (
          /^pro-[a-z0-9]+$/i.test(powerDraft.instanceUuid.trim())
          && (profile.autoPowerCredentialConfigured || Boolean(powerDraft.developerToken.trim()))
        );
        return (
          <article className="vela-profile-card vela-comfy-card" key={profile.id}>
            <div className="vela-profile-card__header">
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.baseUrl}</span>
              </div>
              <span className={result ? 'vela-secret-state' : 'vela-profile-badge'}>
                {result ? <CheckCircle2 size={13} aria-hidden="true" /> : <Cloud size={13} aria-hidden="true" />}
                {result ? stateLabels[result.state] : profile.transport === 'ssh' ? 'SSH 自动连接' : '待检测'}
              </span>
            </div>
            <div className="vela-comfy-meta">
              <span><Server size={13} aria-hidden="true" /> {profile.platform.toUpperCase()}</span>
              <span><Gauge size={13} aria-hidden="true" /> 并发 {profile.maxConcurrency}</span>
              <span><Wifi size={13} aria-hidden="true" /> {profile.transport === 'ssh' ? `SSH ${profile.sshHost}:${profile.sshPort}` : profile.authType === 'none' ? '无鉴权' : '凭据已加密'}</span>
            </div>
            {result && (
              <div className="vela-comfy-diagnostics" role="status">
                <strong>{result.system.gpu?.name || '未读取到 GPU'}</strong>
                <span>显存 {formatVram(result.system.gpu?.vramFree || 0)} 可用 / {formatVram(result.system.gpu?.vramTotal || 0)} 总计</span>
                <span>队列：运行 {result.queue.running} · 等待 {result.queue.pending} · WebSocket {result.websocket?.ok ? '正常' : '未检测'}</span>
              </div>
            )}
            {profile.platform === 'autodl' && (
              <div className="vela-auto-power-panel">
                <div className="vela-auto-power-heading">
                  <span><Power size={14} aria-hidden="true" /> 自动开关机</span>
                  <label className="vela-switch-label">
                    <input
                      type="checkbox"
                      checked={powerDraft.enabled}
                      onChange={(event) => patchPowerDraft(profile, { enabled: event.target.checked })}
                    />
                    <span>{powerDraft.enabled ? '已开启' : '已关闭'}</span>
                  </label>
                </div>
                <div className="vela-form-grid vela-form-grid--two">
                  <label className="vela-field-stack">
                    <span className="vela-field-label">容器实例 Pro UUID</span>
                    <input
                      className="vela-input vela-utility-text"
                      placeholder="pro-xxxxxxxxxxxx"
                      value={powerDraft.instanceUuid}
                      onChange={(event) => patchPowerDraft(profile, { instanceUuid: event.target.value })}
                    />
                  </label>
                  <label className="vela-field-stack">
                    <span className="vela-field-label">Developer Token</span>
                    <input
                      className="vela-input vela-utility-text"
                      type="password"
                      autoComplete="new-password"
                      placeholder={profile.autoPowerCredentialConfigured ? '已加密保存；留空不修改' : '请输入 Developer Token'}
                      value={powerDraft.developerToken}
                      onChange={(event) => patchPowerDraft(profile, { developerToken: event.target.value })}
                    />
                  </label>
                  <label className="vela-field-stack">
                    <span className="vela-field-label">空闲关机（分钟）</span>
                    <input
                      className="vela-input"
                      type="number"
                      min="1"
                      max="60"
                      value={powerDraft.idleShutdownMinutes}
                      onChange={(event) => patchPowerDraft(profile, {
                        idleShutdownMinutes: Math.min(60, Math.max(1, Number(event.target.value) || 5))
                      })}
                    />
                  </label>
                  <label className="vela-field-stack">
                    <span className="vela-field-label">开机等待（分钟）</span>
                    <input
                      className="vela-input"
                      type="number"
                      min="1"
                      max="30"
                      value={powerDraft.powerOnTimeoutMinutes}
                      onChange={(event) => patchPowerDraft(profile, {
                        powerOnTimeoutMinutes: Math.min(30, Math.max(1, Number(event.target.value) || 10))
                      })}
                    />
                  </label>
                </div>
                <p className="vela-field-help">
                  有任务时自动开机；本地任务和 ComfyUI 远端队列都为空后才关机。关机不会删除模型，但连续关机 15 天存在实例释放风险。
                </p>
                {powerResult && (
                  <div className="vela-auto-power-status" role="status">
                    <CheckCircle2 size={13} aria-hidden="true" /> 控制接口正常 · 实例 {powerResult.remoteState}
                  </div>
                )}
                <div className="vela-profile-actions">
                  <button
                    className="vela-button"
                    type="button"
                    disabled={Boolean(busyId) || !powerDraftReady}
                    onClick={() => void savePowerSettings(profile)}
                  >
                    {busyId === `power-save-${profile.id}` ? <LoaderCircle className="vela-spin" size={14} /> : <Save size={14} />} 保存自动开关机
                  </button>
                  <button
                    className="vela-button"
                    type="button"
                    disabled={Boolean(busyId) || !profile.autoPowerEnabled || !profile.autoPowerCredentialConfigured}
                    onClick={() => void testPowerConnection(profile)}
                  >
                    {busyId === `power-test-${profile.id}` ? <LoaderCircle className="vela-spin" size={14} /> : <Activity size={14} />} 检测电源接口
                  </button>
                </div>
              </div>
            )}
            <div className="vela-profile-actions">
              <button className="vela-button" type="button" disabled={Boolean(busyId)} onClick={() => void testConnection(profile)}>
                {busyId === profile.id ? <LoaderCircle className="vela-spin" size={14} /> : <Activity size={14} />} 全面检测
              </button>
              <button
                className="vela-button vela-icon-button"
                type="button"
                disabled={Boolean(busyId)}
                title="删除连接"
                aria-label={`删除 ${profile.name}`}
                onClick={async () => {
                  if (!window.confirm(`确认删除连接“${profile.name}”？`)) return;
                  await deleteVelaProfile(profile.id);
                  await onProfilesChanged();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </article>
        );
      })}

      {isAdding && (
        <div className="vela-profile-form vela-comfy-form">
          <div className="vela-form-grid vela-form-grid--two">
            <label className="vela-field-stack">
              <span className="vela-field-label">平台预设</span>
              <select className="vela-input" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as typeof form.platform })}>
                <option value="autodl">AutoDL</option>
                <option value="runpod">RunPod</option>
                <option value="generic">通用 ComfyUI</option>
              </select>
            </label>
            <label className="vela-field-stack">
              <span className="vela-field-label">最大并发</span>
              <input className="vela-input" type="number" min="1" max="16" value={form.maxConcurrency} onChange={(event) => setForm({ ...form, maxConcurrency: Math.max(1, Number(event.target.value) || 1) })} />
            </label>
          </div>
          <label className="vela-field-stack">
            <span className="vela-field-label">连接名称</span>
            <input className="vela-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="vela-field-stack">
            <span className="vela-field-label">连接方式</span>
            <select className="vela-input" value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as ComfyTransport })}>
              <option value="ssh">SSH 自动隧道（AutoDL 推荐）</option>
              <option value="direct">公网地址直连</option>
            </select>
          </label>
          {form.transport === 'ssh' && (
            <>
              <div className="vela-form-grid vela-form-grid--two">
                <label className="vela-field-stack"><span className="vela-field-label">SSH 主机</span><input className="vela-input vela-utility-text" value={form.sshHost} onChange={(event) => setForm({ ...form, sshHost: event.target.value })} /></label>
                <label className="vela-field-stack"><span className="vela-field-label">SSH 端口</span><input className="vela-input" type="number" min="1" max="65535" value={form.sshPort} onChange={(event) => setForm({ ...form, sshPort: Number(event.target.value) || 22 })} /></label>
              </div>
              <div className="vela-form-grid vela-form-grid--two">
                <label className="vela-field-stack"><span className="vela-field-label">SSH 用户名</span><input className="vela-input" value={form.sshUsername} onChange={(event) => setForm({ ...form, sshUsername: event.target.value })} /></label>
                <label className="vela-field-stack"><span className="vela-field-label">本机转发端口</span><input className="vela-input" type="number" min="1" max="65535" value={form.sshLocalPort} onChange={(event) => {
                  const sshLocalPort = Number(event.target.value) || 18188;
                  setForm({ ...form, sshLocalPort, baseUrl: `http://127.0.0.1:${sshLocalPort}`, websocketUrl: '' });
                }} /></label>
              </div>
              <label className="vela-field-stack"><span className="vela-field-label">SSH 私钥路径</span><input className="vela-input vela-utility-text" value={form.sshPrivateKeyPath} onChange={(event) => setForm({ ...form, sshPrivateKeyPath: event.target.value })} /></label>
              <label className="vela-field-stack"><span className="vela-field-label">远端自动启动脚本</span><input className="vela-input vela-utility-text" value={form.sshStartScript} onChange={(event) => setForm({ ...form, sshStartScript: event.target.value })} /></label>
              <div className="vela-form-grid vela-form-grid--two">
                <label className="vela-field-stack"><span className="vela-field-label">远端 ComfyUI 主机</span><input className="vela-input" value={form.sshRemoteHost} onChange={(event) => setForm({ ...form, sshRemoteHost: event.target.value })} /></label>
                <label className="vela-field-stack"><span className="vela-field-label">远端 ComfyUI 端口</span><input className="vela-input" type="number" min="1" max="65535" value={form.sshRemotePort} onChange={(event) => setForm({ ...form, sshRemotePort: Number(event.target.value) || 8188 })} /></label>
              </div>
            </>
          )}
          {form.platform === 'autodl' && (
            <div className="vela-auto-power-panel">
              <div className="vela-auto-power-heading">
                <span><Power size={14} aria-hidden="true" /> AutoDL Pro 自动开关机</span>
                <label className="vela-switch-label">
                  <input
                    type="checkbox"
                    checked={form.autoPowerEnabled}
                    onChange={(event) => setForm({ ...form, autoPowerEnabled: event.target.checked })}
                  />
                  <span>{form.autoPowerEnabled ? '已开启' : '暂不开启'}</span>
                </label>
              </div>
              {form.autoPowerEnabled && (
                <>
                  <div className="vela-form-grid vela-form-grid--two">
                    <label className="vela-field-stack">
                      <span className="vela-field-label">容器实例 Pro UUID</span>
                      <input
                        className="vela-input vela-utility-text"
                        placeholder="pro-xxxxxxxxxxxx"
                        value={form.autodlInstanceUuid}
                        onChange={(event) => setForm({ ...form, autodlInstanceUuid: event.target.value })}
                      />
                    </label>
                    <label className="vela-field-stack">
                      <span className="vela-field-label">Developer Token</span>
                      <input
                        className="vela-input vela-utility-text"
                        type="password"
                        autoComplete="new-password"
                        value={form.autodlDeveloperToken}
                        onChange={(event) => setForm({ ...form, autodlDeveloperToken: event.target.value })}
                      />
                    </label>
                    <label className="vela-field-stack">
                      <span className="vela-field-label">空闲关机（分钟）</span>
                      <input
                        className="vela-input"
                        type="number"
                        min="1"
                        max="60"
                        value={form.idleShutdownMinutes}
                        onChange={(event) => setForm({ ...form, idleShutdownMinutes: Math.min(60, Math.max(1, Number(event.target.value) || 5)) })}
                      />
                    </label>
                    <label className="vela-field-stack">
                      <span className="vela-field-label">开机等待（分钟）</span>
                      <input
                        className="vela-input"
                        type="number"
                        min="1"
                        max="30"
                        value={form.powerOnTimeoutMinutes}
                        onChange={(event) => setForm({ ...form, powerOnTimeoutMinutes: Math.min(30, Math.max(1, Number(event.target.value) || 10)) })}
                      />
                    </label>
                  </div>
                  <p className="vela-field-help">仅支持 AutoDL 容器实例 Pro 官方 API；Token 只在本机加密保存。</p>
                </>
              )}
            </div>
          )}
          <label className="vela-field-stack">
            <span className="vela-field-label">ComfyUI Base URL</span>
            <input className="vela-input vela-utility-text" type="url" placeholder="https://你的云端地址" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          </label>
          <label className="vela-field-stack">
            <span className="vela-field-label">WebSocket URL（可留空）</span>
            <input className="vela-input vela-utility-text" type="url" placeholder="自动从 Base URL 推导 /ws" value={form.websocketUrl} onChange={(event) => setForm({ ...form, websocketUrl: event.target.value })} />
          </label>
          <label className="vela-field-stack">
            <span className="vela-field-label">鉴权方式</span>
            <select className="vela-input" value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value as typeof form.authType })}>
              <option value="none">无鉴权</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="custom">自定义安全请求头</option>
            </select>
          </label>
          {form.authType === 'bearer' && (
            <label className="vela-field-stack"><span className="vela-field-label">Token</span><input className="vela-input vela-utility-text" type="password" autoComplete="new-password" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} /></label>
          )}
          {form.authType === 'basic' && (
            <div className="vela-form-grid vela-form-grid--two">
              <label className="vela-field-stack"><span className="vela-field-label">用户名</span><input className="vela-input" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
              <label className="vela-field-stack"><span className="vela-field-label">密码</span><input className="vela-input" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            </div>
          )}
          {form.authType === 'custom' && (
            <div className="vela-form-grid vela-form-grid--header">
              <select className="vela-input" aria-label="安全请求头名称" value={form.customHeaderName} onChange={(event) => setForm({ ...form, customHeaderName: event.target.value })}>
                <option value="x-api-key">X-API-Key</option>
                <option value="x-auth-token">X-Auth-Token</option>
                <option value="runpod-api-key">RunPod-API-Key</option>
                <option value="x-comfyui-token">X-ComfyUI-Token</option>
                <option value="cf-access-client-id">CF-Access-Client-Id</option>
                <option value="cf-access-client-secret">CF-Access-Client-Secret</option>
              </select>
              <input className="vela-input vela-utility-text" type="password" aria-label="安全请求头值" placeholder="请求头值" value={form.customHeaderValue} onChange={(event) => setForm({ ...form, customHeaderValue: event.target.value })} />
            </div>
          )}
          <label className="vela-field-stack">
            <span className="vela-field-label">H3 工作流版本</span>
            <input className="vela-input vela-utility-text" value={form.workflowVersion} onChange={(event) => setForm({ ...form, workflowVersion: event.target.value })} />
          </label>
          <p className="vela-field-help">软件只使用标准 ComfyUI API，不绑定平台 SDK。密钥只传给本机后端并加密保存。</p>
          <button
            className="vela-button"
            data-variant="primary"
            type="button"
            disabled={!form.name.trim() || !form.baseUrl.trim() || !credentialReady || !autoPowerReady || Boolean(busyId)}
            onClick={() => void saveConnection()}
          >
            {busyId === 'new-comfy' ? <LoaderCircle className="vela-spin" size={15} /> : <Plus size={15} />} 加密保存连接
          </button>
        </div>
      )}
    </section>
  );
}
