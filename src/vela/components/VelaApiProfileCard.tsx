import { Activity, CheckCircle2, LoaderCircle, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  deleteVelaProfile,
  testVelaProfile,
  updateVelaProfile,
  VelaProfileRequestError,
  normalizeGptVelaProfile,
  type GptVelaProfile
} from '../services/profileService';

interface VelaApiProfileCardProps {
  profile: GptVelaProfile;
  onChanged: () => void | Promise<unknown>;
  onMessage: (message: string) => void;
}

export function VelaApiProfileCard({ profile, onChanged, onMessage }: VelaApiProfileCardProps) {
  const [draft, setDraft] = useState(() => normalizeGptVelaProfile(profile));
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [testState, setTestState] = useState<{ status: 'ok' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setDraft(normalizeGptVelaProfile(profile));
    if (profile.credentialStatus === 'ready') setTestState(null);
  }, [profile]);

  const save = async () => {
    try {
      setBusy('save');
      await updateVelaProfile(profile.id, {
        name: draft.name,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        models: draft.models,
        endpoints: draft.endpoints,
        timeoutMs: draft.timeoutMs,
        maxConcurrency: draft.maxConcurrency,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      });
      setApiKey('');
      await onChanged();
      onMessage(`“${draft.name}”已保存，密钥仍只保存在本机。`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '保存 API 账户失败');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    try {
      setBusy('test');
      const result = await testVelaProfile(profile.id);
      if (!('models' in result)) throw new Error('模型列表返回格式不正确');
      setModels(result.models);
      setTestState({ status: 'ok', message: `连接正常，当前可用 ${result.models.length} 个模型` });
      onMessage(`“${profile.name}”连接成功，读取到 ${result.models.length} 个模型。`);
    } catch (error) {
      if (error instanceof VelaProfileRequestError && error.details?.availableModels) {
        setModels(error.details.availableModels);
      }
      const missing = error instanceof VelaProfileRequestError ? error.details?.missingModels || [] : [];
      const message = missing.length
        ? `模型配置异常：当前中转账号不再提供 ${missing.join('、')}，请从已读取的模型中更换，或改用其他账户。`
        : error instanceof Error ? error.message : '连接测试失败';
      setTestState({ status: 'error', message });
      onMessage(message);
    } finally {
      setBusy(null);
    }
  };

  const modelInput = (label: string, key: keyof GptVelaProfile['models'], placeholder: string) => (
    <label className="vela-settings-field">
      <span>{label}</span>
      <input
        list={models.length ? `models-${profile.id}` : undefined}
        value={draft.models[key] || ''}
        placeholder={placeholder}
        onChange={(event) => setDraft({ ...draft, models: { ...draft.models, [key]: event.target.value } })}
      />
    </label>
  );

  return (
    <article className="vela-api-card">
      <div className="vela-api-card-heading">
        <span className="vela-api-card-icon" aria-hidden="true"><Activity size={18} /></span>
        <div><strong>{profile.name}</strong><span>{profile.provider || 'OpenAI Compatible'}</span></div>
        <span className="vela-api-secret" data-status={profile.credentialStatus || (profile.secretConfigured ? 'ready' : 'missing')}>
          {profile.credentialStatus === 'unreadable'
            ? <><TriangleAlert size={13} /> 密钥需重新输入</>
            : <><CheckCircle2 size={13} /> 密钥已保存</>}
        </span>
      </div>

      <div className="vela-settings-grid vela-settings-grid--two">
        <label className="vela-settings-field"><span>账户名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="vela-settings-field"><span>供应商标识</span><input value={draft.provider || ''} placeholder="例如 YMAN / Seedance" onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></label>
      </div>
      <label className="vela-settings-field"><span>中转站 Base URL</span><input className="vela-utility-text" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
      <div className="vela-settings-grid vela-settings-grid--three">
        {modelInput('提示词模型', 'prompt', '例如 gpt-5.4')}
        {modelInput('图片模型', 'image', '例如 gpt-image-2')}
        {modelInput('视频模型', 'video', '例如 seedance-2.0')}
      </div>
      {models.length > 0 && <datalist id={`models-${profile.id}`}>{models.map((model) => <option key={model} value={model} />)}</datalist>}

      <details className="vela-api-advanced">
        <summary>接口路径与性能</summary>
        <div className="vela-settings-grid vela-settings-grid--two">
          {Object.entries(draft.endpoints).map(([key, value]) => (
            <label className="vela-settings-field" key={key}>
              <span>{endpointLabels[key] || key}</span>
              <input className="vela-utility-text" value={value} onChange={(event) => setDraft({ ...draft, endpoints: { ...draft.endpoints, [key]: event.target.value } })} />
            </label>
          ))}
          <label className="vela-settings-field"><span>并发数</span><input type="number" min="1" max="10" value={draft.maxConcurrency} onChange={(event) => setDraft({ ...draft, maxConcurrency: Math.max(1, Number(event.target.value) || 1) })} /></label>
          <label className="vela-settings-field"><span>任务超时（秒）</span><input type="number" min="1" max="3600" value={Math.round(draft.timeoutMs / 1000)} onChange={(event) => setDraft({ ...draft, timeoutMs: Math.max(1, Math.min(3600, Number(event.target.value) || 60)) * 1000 })} /></label>
        </div>
      </details>

      <label className="vela-settings-field"><span>更换 API Key（不修改请留空）</span><input type="password" autoComplete="new-password" value={apiKey} placeholder="已加密保存；留空表示不修改" onChange={(event) => setApiKey(event.target.value)} /></label>
      {testState && (
        <div className="vela-api-test-state" data-status={testState.status} role="status">
          {testState.message}
        </div>
      )}
      <div className="vela-api-card-actions">
        <button type="button" onClick={() => void test()} disabled={busy !== null}>{busy === 'test' ? <LoaderCircle className="vela-spin" size={15} /> : <Activity size={15} />} 测试并读取模型</button>
        <button type="button" data-primary="true" onClick={() => void save()} disabled={busy !== null || !draft.name.trim() || !draft.baseUrl.trim()}>{busy === 'save' ? <LoaderCircle className="vela-spin" size={15} /> : <Save size={15} />} 保存修改</button>
        <button type="button" className="vela-api-delete" aria-label={`删除 ${profile.name}`} onClick={async () => {
          if (!window.confirm(`确认删除账户“${profile.name}”？`)) return;
          await deleteVelaProfile(profile.id);
          await onChanged();
          onMessage(`已删除“${profile.name}”。`);
        }}><Trash2 size={15} /></button>
      </div>
    </article>
  );
}

const endpointLabels: Record<string, string> = {
  models: '模型列表',
  chat: 'Chat Completions',
  imageGeneration: '图片生成',
  imageEdit: '图片编辑',
  videoGeneration: '视频任务提交',
  videoStatus: '视频任务查询（{id} 为任务 ID）'
};
