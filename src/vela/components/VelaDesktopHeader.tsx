import {
  Archive,
  Cloud,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minus,
  RefreshCw,
  Square,
  WalletCards,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import appIcon from '../../../build/icon.png';
import {
  getVelaCloudAccountOverview,
  type VelaCloudAccountOverview
} from '../services/cloudAccountService';
import './VelaDesktopHeader.css';

const AUTODL_RECHARGE_URL = 'https://www.autodl.com/home';

interface VelaDesktopHeaderProps {
  theme: 'light' | 'dark';
  onOpenConnections: () => void;
}

const formatMoney = (value?: number) => Number.isFinite(value) ? `¥${Number(value).toFixed(2)}` : '未读取';

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** index)).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
};

export function VelaDesktopHeader({ theme, onOpenConnections }: VelaDesktopHeaderProps) {
  const [account, setAccount] = useState<VelaCloudAccountOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'balance' | 'repository' | null>(null);
  const [maximized, setMaximized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bridge = window.velaDesktop;

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAccount(await getVelaCloudAccountOverview());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '云账户读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!bridge?.windowControls) return;
    void bridge.windowControls.getState().then((state) => setMaximized(state.maximized));
    return bridge.windowControls.onState((state) => setMaximized(state.maximized));
  }, [bridge]);
  useEffect(() => {
    if (!panel) return;
    const close = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setPanel(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const openRecharge = () => window.open(AUTODL_RECHARGE_URL, '_blank', 'noopener,noreferrer');
  const balanceLabel = account?.configured && account.balance
    ? formatMoney(account.balance.availableYuan)
    : account?.configured ? '读取失败' : '未绑定';
  const repositoryCount = account?.repository?.total;

  return (
    <header className="vela-desktop-header" data-theme={theme} aria-label="应用与云账户">
      <div className="vela-desktop-header__drag-region">
        <img src={appIcon} alt="" />
        <strong>V-MNH</strong>
        <span>AI 创作工作台</span>
      </div>

      <div className="vela-cloud-actions" ref={panelRef}>
        <button className="vela-cloud-action" type="button" onClick={openRecharge} title="前往 AutoDL 官方页面充值">
          <WalletCards size={15} aria-hidden="true" />
          <span>充值</span>
          <ExternalLink size={12} aria-hidden="true" />
        </button>
        <button
          className="vela-cloud-action"
          type="button"
          aria-expanded={panel === 'repository'}
          data-active={panel === 'repository' || undefined}
          onClick={() => setPanel((current) => current === 'repository' ? null : 'repository')}
        >
          <Archive size={15} aria-hidden="true" />
          <span>个人仓库</span>
          {Number.isFinite(repositoryCount) && <b>{repositoryCount}</b>}
        </button>
        <button
          className="vela-cloud-action vela-cloud-action--balance"
          type="button"
          aria-expanded={panel === 'balance'}
          data-active={panel === 'balance' || undefined}
          onClick={() => setPanel((current) => current === 'balance' ? null : 'balance')}
        >
          <Cloud size={15} aria-hidden="true" />
          <span>账号余额</span>
          <b>{loading ? <LoaderCircle className="vela-spin" size={13} aria-label="正在读取" /> : balanceLabel}</b>
        </button>

        {panel && (
          <section className="vela-cloud-popover" role="dialog" aria-label={panel === 'balance' ? '云端账号余额' : '云端个人仓库'}>
            <header>
              <div>
                {panel === 'balance' ? <WalletCards size={18} aria-hidden="true" /> : <Archive size={18} aria-hidden="true" />}
                <span><strong>{panel === 'balance' ? '账号余额' : '个人仓库'}</strong><small>{account?.profileName || 'AutoDL'}</small></span>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="刷新云端账户"><RefreshCw className={loading ? 'vela-spin' : undefined} size={15} /></button>
            </header>

            {!account?.configured ? (
              <div className="vela-cloud-empty">
                <Cloud size={24} aria-hidden="true" />
                <strong>尚未绑定 AutoDL</strong>
                <span>{account?.message || error || '请先配置云端算力账户'}</span>
                <button type="button" onClick={() => { setPanel(null); onOpenConnections(); }}>打开 API / 算力设置</button>
              </div>
            ) : error ? (
              <div className="vela-cloud-empty"><strong>读取失败</strong><span>{error}</span><button type="button" onClick={() => void refresh()}>重试</button></div>
            ) : panel === 'balance' ? (
              <div className="vela-cloud-balance">
                <div><span>可用余额</span><strong>{formatMoney(account.balance?.availableYuan)}</strong></div>
                <div><span>代金券</span><strong>{formatMoney(account.balance?.voucherYuan)}</strong></div>
                <div><span>累计消费</span><strong>{formatMoney(account.balance?.accumulatedYuan)}</strong></div>
                {account.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
                <button type="button" onClick={openRecharge}><WalletCards size={15} />前往官方充值</button>
              </div>
            ) : (
              <div className="vela-cloud-repository">
                <div className="vela-cloud-repository__summary"><span>AutoDL 私有镜像</span><strong>{account.repository?.total ?? 0} 个</strong></div>
                {(account.repository?.items || []).length > 0 ? (
                  <ul>
                    {account.repository?.items.map((item) => (
                      <li key={item.id}>
                        <span><strong>{item.name}</strong><small>{formatBytes(item.sizeBytes)} · {item.status === 'finished' ? '可用' : item.status}</small></span>
                        <time>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '—'}</time>
                      </li>
                    ))}
                  </ul>
                ) : <div className="vela-cloud-empty vela-cloud-empty--compact"><span>仓库中还没有可显示的私有镜像</span></div>}
                {account.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
          </section>
        )}
      </div>

      {bridge?.windowControls && (
        <nav className="vela-window-controls" aria-label="窗口控制">
          <button type="button" onClick={() => void bridge.windowControls.minimize()} aria-label="最小化窗口" title="最小化"><Minus size={16} /></button>
          <button type="button" onClick={() => void bridge.windowControls.toggleMaximize()} aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'}>
            {maximized ? <Square size={13} /> : <Maximize2 size={14} />}
          </button>
          <button className="vela-window-controls__close" type="button" onClick={() => void bridge.windowControls.close()} aria-label="关闭窗口" title="关闭到后台"><X size={17} /></button>
        </nav>
      )}
    </header>
  );
}
