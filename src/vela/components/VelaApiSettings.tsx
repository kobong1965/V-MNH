import { CloudCog, KeyRound, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import {
  createVelaProfile,
  type GptVelaProfile,
  type VelaProfile
} from '../services/profileService';
import { VelaApiProfileCard } from './VelaApiProfileCard';
import { VelaComputePanel } from './VelaComputePanel';

interface VelaApiSettingsProps {
  profiles: VelaProfile[];
  profilesError?: string | null;
  onProfilesChanged: () => void | Promise<unknown>;
}

const PRESETS = {
  yman: { name: 'YMAN 主账户', provider: 'YMAN', baseUrl: 'https://api.yman.cc/v1' },
  boundless: {
    name: 'Boundless Seedance 2.5',
    provider: 'Boundless',
    baseUrl: 'https://boundles.cc/v1',
    videoModel: 'seedance-2.5-720p',
    videoGeneration: '/videos',
    videoStatus: '/videos/{id}',
    timeoutSeconds: 1800
  },
  openai: { name: 'OpenAI 兼容账户', provider: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1' },
  seedance: { name: 'Seedance 视频账户', provider: 'Seedance', baseUrl: '' },
  minimax: { name: 'MiniMax API 账户', provider: 'MiniMax', baseUrl: '' },
  custom: { name: '自定义模型账户', provider: 'Custom', baseUrl: '' }
} as const;

interface ApiFormState {
  preset: keyof typeof PRESETS;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  promptModel: string;
  imageModel: string;
  videoModel: string;
  analysisModel: string;
  endpoints: {
    models: string;
    chat: string;
    imageGeneration: string;
    imageEdit: string;
    videoGeneration: string;
    videoStatus: string;
  };
  maxConcurrency: number;
  timeoutSeconds: number;
}

const INITIAL_FORM: ApiFormState = {
  preset: 'yman' as keyof typeof PRESETS,
  ...PRESETS.yman,
  apiKey: '',
  promptModel: '',
  imageModel: '',
  videoModel: '',
  analysisModel: '',
  endpoints: {
    models: '/models',
    chat: '/chat/completions',
    imageGeneration: '/images/generations',
    imageEdit: '/images/edits',
    videoGeneration: '/videos/generations',
    videoStatus: '/videos/{id}'
  },
  maxConcurrency: 2,
  timeoutSeconds: 60
};

export function VelaApiSettings({ profiles, profilesError, onProfilesChanged }: VelaApiSettingsProps) {
  const [form, setForm] = useState<ApiFormState>(INITIAL_FORM);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const gptProfiles = profiles.filter((profile): profile is GptVelaProfile => profile.type === 'gpt');

  const setPreset = (preset: keyof typeof PRESETS) => {
    const values = PRESETS[preset];
    setForm((current) => ({
      ...current,
      preset,
      name: values.name,
      provider: values.provider,
      baseUrl: values.baseUrl,
      promptModel: '',
      imageModel: '',
      videoModel: 'videoModel' in values ? values.videoModel : '',
      analysisModel: '',
      timeoutSeconds: 'timeoutSeconds' in values ? values.timeoutSeconds : 60,
      endpoints: {
        ...INITIAL_FORM.endpoints,
        videoGeneration: 'videoGeneration' in values ? values.videoGeneration : INITIAL_FORM.endpoints.videoGeneration,
        videoStatus: 'videoStatus' in values ? values.videoStatus : INITIAL_FORM.endpoints.videoStatus
      }
    }));
  };

  const create = async () => {
    try {
      setBusy(true);
      setMessage('');
      await createVelaProfile({
        name: form.name,
        provider: form.provider,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        models: {
          prompt: form.promptModel,
          image: form.imageModel,
          video: form.videoModel,
          analysis: form.analysisModel
        },
        endpoints: form.endpoints,
        maxConcurrency: form.maxConcurrency,
        timeoutMs: form.timeoutSeconds * 1000
      });
      setForm(INITIAL_FORM);
      setAdding(false);
      await onProfilesChanged();
      setMessage('API 账户已加密保存。现在可测试连接并读取模型。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存 API 账户失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vela-settings-page">
      <header className="vela-settings-heading">
        <div><span>连接中心</span><h1>API 与算力</h1><p>把图片、文本、视频模型和云端 ComfyUI 集中保存在这里，画布节点只需选择账户名称。</p></div>
        <span className="vela-settings-security"><ShieldCheck size={16} /> 密钥仅在本机加密保存</span>
      </header>

      {(message || profilesError) && <div className="vela-settings-message" role="status">{message || profilesError}</div>}

      <section className="vela-settings-section" aria-labelledby="model-api-title">
        <div className="vela-settings-section-heading"><div><KeyRound size={19} /><div><h2 id="model-api-title">大模型 API</h2><p>支持 OpenAI 兼容中转以及可自定义端点的图片、文本和视频模型。</p></div></div><button type="button" onClick={() => setAdding((value) => !value)}><Plus size={16} />{adding ? '收起' : '添加 API'}</button></div>

        {adding && (
          <div className="vela-api-card vela-api-new-card">
            <div className="vela-api-card-heading"><span className="vela-api-card-icon"><Plus size={18} /></span><div><strong>添加大模型 API</strong><span>选择预设后仍可修改全部字段</span></div></div>
            <div className="vela-settings-grid vela-settings-grid--three">
              <label className="vela-settings-field"><span>连接预设</span><select value={form.preset} onChange={(event) => setPreset(event.target.value as keyof typeof PRESETS)}>{Object.entries(PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.provider}</option>)}</select></label>
              <label className="vela-settings-field"><span>账户名称</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="vela-settings-field"><span>供应商标识</span><input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} /></label>
            </div>
            <label className="vela-settings-field"><span>中转站 Base URL</span><input className="vela-utility-text" placeholder="https://example.com/v1" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
            <div className="vela-settings-grid vela-settings-grid--three">
              <label className="vela-settings-field"><span>提示词模型</span><input placeholder="可留空" value={form.promptModel} onChange={(event) => setForm({ ...form, promptModel: event.target.value })} /></label>
              <label className="vela-settings-field"><span>图片模型</span><input placeholder="可留空" value={form.imageModel} onChange={(event) => setForm({ ...form, imageModel: event.target.value })} /></label>
              <label className="vela-settings-field"><span>视频模型</span><input placeholder="可留空" value={form.videoModel} onChange={(event) => setForm({ ...form, videoModel: event.target.value })} /></label>
              <label className="vela-settings-field"><span>Qwen 分析模型</span><input placeholder="例如 qwen3-vl-plus，以中转站为准" value={form.analysisModel} onChange={(event) => setForm({ ...form, analysisModel: event.target.value })} /></label>
            </div>
            <div className="vela-settings-grid vela-settings-grid--three">
              <label className="vela-settings-field"><span>API Key</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></label>
              <label className="vela-settings-field"><span>并发数</span><input type="number" min="1" max="10" value={form.maxConcurrency} onChange={(event) => setForm({ ...form, maxConcurrency: Math.max(1, Number(event.target.value) || 1) })} /></label>
              <label className="vela-settings-field"><span>任务超时（秒）</span><input type="number" min="1" max="3600" value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Math.max(1, Math.min(3600, Number(event.target.value) || 60)) })} /></label>
            </div>
            <details className="vela-api-advanced vela-api-new-advanced">
              <summary>接口路径（可选）</summary>
              <div className="vela-settings-grid vela-settings-grid--two">
                {Object.entries(form.endpoints || INITIAL_FORM.endpoints).map(([key, value]) => (
                  <label className="vela-settings-field" key={key}>
                    <span>{endpointLabels[key] || key}</span>
                    <input
                      className="vela-utility-text"
                      value={value}
                      onChange={(event) => setForm({ ...form, endpoints: { ...(form.endpoints || INITIAL_FORM.endpoints), [key]: event.target.value } })}
                    />
                  </label>
                ))}
              </div>
            </details>
            <div className="vela-api-card-actions"><button type="button" data-primary="true" disabled={busy || !form.name.trim() || !form.baseUrl.trim() || !form.apiKey.trim()} onClick={() => void create()}>{busy ? <LoaderCircle className="vela-spin" size={15} /> : <Plus size={15} />} 加密保存账户</button></div>
          </div>
        )}

        <div className="vela-api-grid">
          {gptProfiles.map((profile) => <VelaApiProfileCard key={profile.id} profile={profile} onChanged={onProfilesChanged} onMessage={setMessage} />)}
          {gptProfiles.length === 0 && !adding && <div className="vela-settings-empty"><KeyRound size={22} /><strong>还没有大模型 API</strong><span>点击“添加 API”配置第一个中转账户。</span></div>}
        </div>
      </section>

      <section className="vela-settings-section vela-api-compute-wrap" aria-labelledby="canvas-compute-title">
        <div className="vela-settings-section-heading"><div><CloudCog size={19} /><div><h2 id="canvas-compute-title">画布算力</h2><p>这里与画布右上角的“算力”面板完全同步，可直接管理 GPT 账户和云端 ComfyUI。</p></div></div></div>
        <VelaComputePanel
          embedded
          profiles={profiles}
          profilesError={profilesError}
          onProfilesChanged={onProfilesChanged}
        />
      </section>
    </div>
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
