import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Cloud, KeyRound, LoaderCircle, Plus, Trash2, TriangleAlert, X } from 'lucide-react';

import {
  createVelaProfile,
  deleteVelaProfile,
  testVelaProfile,
  updateVelaProfile,
  type GptVelaProfile,
  type VelaProfile
} from '../services/profileService';
import { VelaComfySection } from './VelaComfySection';

interface VelaComputePanelProps {
  isOpen?: boolean;
  embedded?: boolean;
  profiles: VelaProfile[];
  profilesError?: string | null;
  onProfilesChanged: () => void | Promise<unknown>;
  onClose?: () => void;
}

const INITIAL_FORM = {
  name: 'YMAN 主账户',
  baseUrl: 'https://api.yman.cc/v1',
  apiKey: '',
  promptModel: '',
  imageModel: ''
};

export function VelaComputePanel({
  isOpen = false,
  embedded = false,
  profiles,
  profilesError,
  onProfilesChanged,
  onClose
}: VelaComputePanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const gptSectionTitleId = useId();
  const [form, setForm] = useState(INITIAL_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const gptProfiles = profiles.filter((profile): profile is GptVelaProfile => profile.type === 'gpt');
  const comfyProfiles = profiles.filter((profile) => profile.type === 'comfy');

  useEffect(() => { if (isOpen && !embedded) closeButtonRef.current?.focus(); }, [embedded, isOpen]);
  if (!isOpen && !embedded) return null;

  const saveAccount = async () => {
    try {
      setBusyId('new-gpt');
      setMessage(null);
      await createVelaProfile({
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        models: { prompt: form.promptModel, image: form.imageModel },
        maxConcurrency: 2
      });
      setForm(INITIAL_FORM);
      await onProfilesChanged();
      setMessage('账户已加密保存。点击“测试并读取模型”可检查连接。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存账户失败');
    } finally {
      setBusyId(null);
    }
  };

  const testAccount = async (profile: GptVelaProfile) => {
    try {
      setBusyId(profile.id);
      setMessage(null);
      const result = await testVelaProfile(profile.id);
      if (!('models' in result)) throw new Error('模型列表返回格式不正确');
      setModelOptions((current) => ({ ...current, [profile.id]: result.models }));
      setMessage(`连接成功，读取到 ${result.models.length} 个模型。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setBusyId(null);
    }
  };

  const updateModel = async (profile: GptVelaProfile, kind: 'prompt' | 'image', value: string) => {
    try {
      setBusyId(profile.id);
      await updateVelaProfile(profile.id, { models: { ...profile.models, [kind]: value } });
      await onProfilesChanged();
      setMessage('模型设置已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模型设置保存失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside
      className={`vela-compute-panel vela-panel${embedded ? ' vela-compute-panel--embedded' : ''}`}
      role={embedded ? 'region' : 'dialog'}
      {...(!embedded ? { 'aria-modal': false } : {})}
      aria-labelledby={titleId}
    >
      <div className="vela-panel-heading">
        <Cloud size={17} aria-hidden="true" />
        <h2 id={titleId}>账户与算力连接</h2>
        {!embedded && (
          <button ref={closeButtonRef} className="vela-button vela-icon-button vela-panel-close" onClick={onClose} aria-label="关闭算力面板">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="vela-compute-scroll">
        <section className="vela-connection-section" aria-labelledby={gptSectionTitleId}>
          <div className="vela-section-title" id={gptSectionTitleId}><KeyRound size={15} aria-hidden="true" /> GPT 中转账户</div>
          {gptProfiles.map((profile) => {
            const options = modelOptions[profile.id] || [];
            return (
              <article className="vela-profile-card" key={profile.id}>
                <div className="vela-profile-card__header">
                  <div><strong>{profile.name}</strong><span>{profile.baseUrl}</span></div>
                  <span className="vela-secret-state" data-status={profile.credentialStatus || (profile.secretConfigured ? 'ready' : 'missing')}>
                    {profile.credentialStatus === 'unreadable'
                      ? <><TriangleAlert size={13} aria-hidden="true" /> Key 需重新输入</>
                      : <><CheckCircle2 size={13} aria-hidden="true" /> Key 已配置</>}
                  </span>
                </div>
                <label className="vela-field-stack">
                  <span className="vela-field-label">提示词模型</span>
                  {options.length ? (
                    <select className="vela-input" value={profile.models.prompt} disabled={busyId === profile.id} onChange={(event) => void updateModel(profile, 'prompt', event.target.value)}>
                      <option value="">请选择</option>{options.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  ) : <span className="vela-profile-model">{profile.models.prompt || '测试连接后选择'}</span>}
                </label>
                <label className="vela-field-stack">
                  <span className="vela-field-label">图片模型</span>
                  {options.length ? (
                    <select className="vela-input" value={profile.models.image} disabled={busyId === profile.id} onChange={(event) => void updateModel(profile, 'image', event.target.value)}>
                      <option value="">请选择</option>{options.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  ) : <span className="vela-profile-model">{profile.models.image || '测试连接后选择'}</span>}
                </label>
                <div className="vela-profile-actions">
                  <button className="vela-button" type="button" disabled={Boolean(busyId)} onClick={() => void testAccount(profile)}>
                    {busyId === profile.id ? <LoaderCircle className="vela-spin" size={14} /> : <Cloud size={14} />} 测试并读取模型
                  </button>
                  <button className="vela-button vela-icon-button" type="button" disabled={Boolean(busyId)} title="删除账户" aria-label={`删除 ${profile.name}`} onClick={async () => {
                    if (!window.confirm(`确认删除账户“${profile.name}”？`)) return;
                    await deleteVelaProfile(profile.id); await onProfilesChanged();
                  }}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              </article>
            );
          })}
        </section>

        <details className="vela-connection-section vela-profile-form vela-collapsible-form">
          <summary className="vela-section-title"><Plus size={15} aria-hidden="true" /> 添加 GPT 中转账户</summary>
          <label className="vela-field-stack"><span className="vela-field-label">账户名称</span><input className="vela-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="vela-field-stack"><span className="vela-field-label">API Base URL</span><input className="vela-input vela-utility-text" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
          <label className="vela-field-stack"><span className="vela-field-label">API Key</span><input className="vela-input vela-utility-text" type="password" autoComplete="new-password" value={form.apiKey} placeholder="只在保存时传给本机后端" onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></label>
          <p className="vela-field-help">模型名可以先留空。保存后测试连接，软件会从中转站读取模型列表。</p>
          <button className="vela-button" data-variant="primary" type="button" disabled={!form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim() || Boolean(busyId)} onClick={() => void saveAccount()}>
            {busyId === 'new-gpt' ? <LoaderCircle className="vela-spin" size={15} /> : <Plus size={15} />} 加密保存账户
          </button>
        </details>

        <VelaComfySection profiles={comfyProfiles} onProfilesChanged={onProfilesChanged} onMessage={setMessage} />
        {(message || profilesError) && <div className="vela-connection-message" role="status">{message || profilesError}</div>}
      </div>
    </aside>
  );
}
