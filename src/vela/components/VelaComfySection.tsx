import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Gauge,
  LoaderCircle,
  Plus,
  Server,
  Trash2,
  Wifi
} from 'lucide-react';

import {
  createComfyProfile,
  deleteVelaProfile,
  testVelaProfile,
  type ComfyAuthType,
  type ComfyConnectionResult,
  type ComfyPlatform,
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
  baseUrl: '',
  websocketUrl: '',
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

export function VelaComfySection({ profiles, onProfilesChanged, onMessage, showHeading = true }: VelaComfySectionProps) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ComfyConnectionResult>>({});

  const credentialReady = form.authType === 'none'
    || (form.authType === 'bearer' && Boolean(form.token.trim()))
    || (form.authType === 'basic' && Boolean(form.username.trim() && form.password))
    || (form.authType === 'custom' && Boolean(form.customHeaderName.trim() && form.customHeaderValue.trim()));

  const saveConnection = async () => {
    try {
      setBusyId('new-comfy');
      onMessage(null);
      await createComfyProfile({
        name: form.name,
        platform: form.platform,
        baseUrl: form.baseUrl,
        websocketUrl: form.websocketUrl || undefined,
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
        return (
          <article className="vela-profile-card vela-comfy-card" key={profile.id}>
            <div className="vela-profile-card__header">
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.baseUrl}</span>
              </div>
              <span className={result ? 'vela-secret-state' : 'vela-profile-badge'}>
                {result ? <CheckCircle2 size={13} aria-hidden="true" /> : <Cloud size={13} aria-hidden="true" />}
                {result ? stateLabels[result.state] : '待检测'}
              </span>
            </div>
            <div className="vela-comfy-meta">
              <span><Server size={13} aria-hidden="true" /> {profile.platform.toUpperCase()}</span>
              <span><Gauge size={13} aria-hidden="true" /> 并发 {profile.maxConcurrency}</span>
              <span><Wifi size={13} aria-hidden="true" /> {profile.authType === 'none' ? '无鉴权' : '凭据已加密'}</span>
            </div>
            {result && (
              <div className="vela-comfy-diagnostics" role="status">
                <strong>{result.system.gpu?.name || '未读取到 GPU'}</strong>
                <span>显存 {formatVram(result.system.gpu?.vramFree || 0)} 可用 / {formatVram(result.system.gpu?.vramTotal || 0)} 总计</span>
                <span>队列：运行 {result.queue.running} · 等待 {result.queue.pending} · WebSocket {result.websocket?.ok ? '正常' : '未检测'}</span>
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
            disabled={!form.name.trim() || !form.baseUrl.trim() || !credentialReady || Boolean(busyId)}
            onClick={() => void saveConnection()}
          >
            {busyId === 'new-comfy' ? <LoaderCircle className="vela-spin" size={15} /> : <Plus size={15} />} 加密保存连接
          </button>
        </div>
      )}
    </section>
  );
}
