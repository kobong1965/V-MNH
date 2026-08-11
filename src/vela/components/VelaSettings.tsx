import {
  Check,
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  SunMoon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { AppearanceMode, CanvasColorMode } from '../services/settingsService';

interface VelaSettingsProps {
  appearance: AppearanceMode;
  canvas: CanvasColorMode;
  resolvedAppearance: 'light' | 'dark';
  onAppearanceChange: (value: AppearanceMode) => void;
  onCanvasChange: (value: CanvasColorMode) => void;
}

const appearanceOptions = [
  { value: 'system' as const, label: '跟随系统', description: 'Windows 切换时自动同步', icon: Monitor },
  { value: 'light' as const, label: '明亮模式', description: '主页和设置保持白色', icon: Sun },
  { value: 'dark' as const, label: '深色模式', description: '降低夜间使用亮度', icon: Moon }
];

const statusLabels: Record<VelaUpdateState['status'], string> = {
  idle: '尚未检查更新',
  checking: '正在检查 GitHub Releases…',
  available: '发现新版本',
  'not-available': '当前已是最新版',
  downloading: '正在下载更新…',
  downloaded: '更新已下载，可以安装',
  error: '更新检查失败'
};

export function VelaSettings({ appearance, canvas, resolvedAppearance, onAppearanceChange, onCanvasChange }: VelaSettingsProps) {
  const bridge = window.velaDesktop?.updater;
  const [updateState, setUpdateState] = useState<VelaUpdateState>({
    supported: Boolean(bridge), currentVersion: '0.5.0', status: 'idle', owner: 'kobong1965', repo: 'V-MNH', privateRepository: false, tokenConfigured: false
  });
  const [updateForm, setUpdateForm] = useState({ owner: 'kobong1965', repo: 'V-MNH', privateRepository: false, token: '' });
  const [savingUpdateConfig, setSavingUpdateConfig] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getState().then((state) => {
      setUpdateState(state);
      setUpdateForm((current) => ({ ...current, owner: state.owner, repo: state.repo, privateRepository: state.privateRepository }));
    });
    return bridge.onState(setUpdateState);
  }, [bridge]);

  const updateAction = useMemo(() => {
    if (updateState.status === 'available') return { label: '下载更新', icon: Download, action: () => bridge?.download() };
    if (updateState.status === 'downloaded') return { label: '重启并安装', icon: RefreshCw, action: () => bridge?.install() };
    return { label: '检查更新', icon: RefreshCw, action: () => bridge?.check() };
  }, [bridge, updateState.status]);
  const UpdateIcon = updateAction.icon;
  const busy = updateState.status === 'checking' || updateState.status === 'downloading';

  const saveUpdateConfig = async () => {
    if (!bridge) return;
    try {
      setSavingUpdateConfig(true);
      const state = await bridge.saveConfig(updateForm);
      setUpdateState(state);
      setUpdateForm((current) => ({ ...current, token: '' }));
    } finally {
      setSavingUpdateConfig(false);
    }
  };

  return (
    <div className="vela-settings-page">
      <header className="vela-settings-heading">
        <div><span>偏好设置</span><h1>设置</h1><p>调整界面、画布颜色和软件更新方式。所有设置都只保存在这台电脑。</p></div>
        <span className="vela-settings-security"><ShieldCheck size={16} /> 本机设置</span>
      </header>

      <section className="vela-settings-section" aria-labelledby="appearance-title">
        <div className="vela-settings-section-heading"><div><SunMoon size={19} /><div><h2 id="appearance-title">模式切换</h2><p>应用界面和画布颜色可以分别设置。</p></div></div><span>当前：{resolvedAppearance === 'dark' ? '深色' : '明亮'}</span></div>
        <div className="vela-mode-options">
          {appearanceOptions.map((option) => {
            const Icon = option.icon;
            return <button type="button" key={option.value} data-selected={appearance === option.value || undefined} onClick={() => onAppearanceChange(option.value)}><span><Icon size={19} /></span><strong>{option.label}</strong><small>{option.description}</small>{appearance === option.value && <Check className="vela-mode-check" size={16} />}</button>;
          })}
        </div>
        <div className="vela-canvas-mode-row">
          <div><strong>画布颜色</strong><span>生成节点与连线保留原有颜色，只改变无限画布和悬浮控件。</span></div>
          <div className="vela-segmented-control" aria-label="画布颜色">
            <button type="button" data-selected={canvas === 'light' || undefined} onClick={() => onCanvasChange('light')}><Sun size={15} /> 白色画布</button>
            <button type="button" data-selected={canvas === 'dark' || undefined} onClick={() => onCanvasChange('dark')}><Moon size={15} /> 黑色画布</button>
          </div>
        </div>
      </section>

      <section className="vela-settings-section" aria-labelledby="update-title">
        <div className="vela-settings-section-heading"><div><Github size={19} /><div><h2 id="update-title">GitHub 同步更新</h2><p>从 Releases 检查新安装包；不会用 Git 直接覆盖项目或账户数据。</p></div></div><span>当前版本 v{updateState.currentVersion}</span></div>
        <div className="vela-update-card">
          <div className="vela-update-status">
            <span className="vela-update-mark" data-status={updateState.status}>{busy ? <LoaderCircle className="vela-spin" size={18} /> : updateState.status === 'downloaded' ? <Check size={18} /> : <RefreshCw size={18} />}</span>
            <div><strong>{statusLabels[updateState.status]}</strong><span>{updateState.message || (updateState.latestVersion ? `GitHub 最新版本 v${updateState.latestVersion}` : `${updateState.owner}/${updateState.repo}`)}</span></div>
            {updateState.status === 'downloading' && <span className="vela-update-progress">{Math.round(updateState.progress || 0)}%</span>}
          </div>
          {updateState.status === 'downloading' && <div className="vela-update-progress-track"><span style={{ width: `${updateState.progress || 0}%` }} /></div>}

          <div className="vela-settings-grid vela-settings-grid--three vela-update-config">
            <label className="vela-settings-field"><span>GitHub 用户名/组织</span><input value={updateForm.owner} onChange={(event) => setUpdateForm({ ...updateForm, owner: event.target.value })} /></label>
            <label className="vela-settings-field"><span>仓库名称</span><input value={updateForm.repo} onChange={(event) => setUpdateForm({ ...updateForm, repo: event.target.value })} /></label>
            <div className="vela-settings-field vela-checkbox-field"><span>仓库类型</span><label><input type="checkbox" checked={updateForm.privateRepository} onChange={(event) => setUpdateForm({ ...updateForm, privateRepository: event.target.checked })} /> 私有仓库</label></div>
          </div>
          {updateForm.privateRepository && <label className="vela-settings-field"><span>GitHub 只读 Token</span><input type="password" autoComplete="new-password" value={updateForm.token} placeholder={updateState.tokenConfigured ? '已由 Windows 加密保存；留空表示不修改' : '填写仅有 Releases 读取权限的 Token'} onChange={(event) => setUpdateForm({ ...updateForm, token: event.target.value })} /></label>}

          <div className="vela-update-actions">
            <button type="button" onClick={() => void saveUpdateConfig()} disabled={!bridge || savingUpdateConfig || !updateForm.owner.trim() || !updateForm.repo.trim()}>{savingUpdateConfig ? <LoaderCircle className="vela-spin" size={15} /> : <ShieldCheck size={15} />} 保存更新来源</button>
            <button type="button" data-primary="true" disabled={!bridge || busy} onClick={() => void updateAction.action()}><UpdateIcon className={busy ? 'vela-spin' : undefined} size={15} /> {updateAction.label}</button>
            <a href={`https://github.com/${updateForm.owner}/${updateForm.repo}/releases`} target="_blank" rel="noreferrer">查看 Releases <ExternalLink size={14} /></a>
          </div>
          {!bridge && <p className="vela-settings-note">网页模式只能修改外观和 API；下载安装更新需要打开 Windows 桌面版。</p>}
          {updateForm.privateRepository && <p className="vela-settings-note">私有 Token 仅由当前 Windows 用户解密。更安全的正式方案是把安装包发布到单独的公开 Releases 仓库。</p>}
        </div>
      </section>
    </div>
  );
}
