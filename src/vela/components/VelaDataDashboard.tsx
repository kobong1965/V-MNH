import { Activity, CircleDollarSign, Clock3, Film, RefreshCw, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchVelaDataDashboard,
  type VelaDashboardBucket,
  type VelaDataDashboardOverview
} from '../services/dataDashboardService';
import './VelaDataDashboard.css';

const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const presetLabels: Record<string, string> = {
  'turbo-4': '极速 · 4 步',
  'turbo-8': '均衡 · 8 步',
  standard: '高清 · 20 步',
  '未设置': '未设置'
};

const formatDuration = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds || 0));
  if (value < 60) return `${value} 秒`;
  const minutes = Math.floor(value / 60);
  return `${minutes} 分 ${value % 60} 秒`;
};

function MetricCard({ icon, label, value, detail, accent = false }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return <article className="vela-dashboard-metric" data-accent={accent || undefined}>
    <span className="vela-dashboard-metric__icon" aria-hidden="true">{icon}</span>
    <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
  </article>;
}

function UsageTable({ rows }: { rows: VelaDashboardBucket[] }) {
  return <div className="vela-dashboard-table-wrap">
    <table className="vela-dashboard-table">
      <thead><tr><th scope="col">尺寸</th><th scope="col">成功视频</th><th scope="col">失败</th><th scope="col">成片时长</th><th scope="col">GPU 用时</th><th scope="col">估算消耗</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <th scope="row">{row.key}</th><td>{integer.format(row.successfulVideos)}</td><td>{integer.format(row.failedVideos)}</td>
        <td>{formatDuration(row.generatedSeconds)}</td><td>{formatDuration(row.gpuSeconds)}</td><td>{money.format(row.estimatedCostYuan)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function VelaDataDashboard() {
  const [data, setData] = useState<VelaDataDashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!quiet) setRefreshing(true);
    try {
      setData(await fetchVelaDataDashboard());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取数据台');
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const balance = data?.account.balance;
  const updatedAt = data ? new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  return <section className="vela-dashboard" aria-labelledby="vela-dashboard-title">
    <header className="vela-dashboard-heading">
      <div><span>H3 运营数据</span><h1 id="vela-dashboard-title">数据台</h1><p>查看 AutoDL 余额、今日视频产量和各尺寸的 GPU 费用估算。</p></div>
      <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="刷新数据台">
        <RefreshCw size={17} className={refreshing ? 'vela-spin' : undefined} aria-hidden="true" />刷新数据
      </button>
    </header>

    {error && <div className="vela-dashboard-alert" role="alert">{error}<button type="button" onClick={() => void refresh()}>重试</button></div>}
    {!data ? <div className="vela-dashboard-loading" role="status">正在汇总本机生成记录和 AutoDL 余额…</div> : <>
      {!data.account.configured && <div className="vela-dashboard-alert" role="status">{data.account.message || '尚未配置 AutoDL Pro Token，任务统计仍可正常查看。'}</div>}
      {data.account.warnings?.map((warning) => <div className="vela-dashboard-alert" role="status" key={warning}>{warning}</div>)}

      <div className="vela-dashboard-kpis">
        <MetricCard icon={<WalletCards size={22} />} label="AutoDL 可用余额" value={balance ? money.format(balance.availableYuan) : '未获取'} detail={balance ? `累计消费 ${money.format(balance.accumulatedYuan)} · 代金券 ${money.format(balance.voucherYuan)}` : '本地任务统计不受影响'} />
        <MetricCard icon={<Film size={22} />} label="今日生成视频" value={`${integer.format(data.summary.successfulVideos)} 条`} detail={`成功成片 ${formatDuration(data.summary.generatedSeconds)} · 失败 ${data.summary.failedVideos} 条`} accent />
        <MetricCard icon={<CircleDollarSign size={22} />} label="今日估算消耗" value={money.format(data.summary.estimatedCostYuan)} detail={`失败消耗 ${money.format(data.summary.failedCostYuan)} · 运行中 ${money.format(data.summary.activeCostYuan)}`} />
        <MetricCard icon={<Activity size={22} />} label="正在处理" value={`${integer.format(data.summary.activeVideos)} 条`} detail={`累计 GPU 用时 ${formatDuration(data.summary.gpuSeconds)}`} />
      </div>

      <article className="vela-dashboard-card">
        <header><div><h2>不同尺寸生成统计</h2><p>按今天创建的 MiniMax H3 任务归类，失败任务的 GPU 消耗也会计入。</p></div><span>{data.date}</span></header>
        <UsageTable rows={data.byResolution} />
      </article>

      <article className="vela-dashboard-card">
        <header><div><h2>生成预设</h2><p>尺寸和预设共同影响运行时间；这里展示实际任务记录。</p></div><Clock3 size={19} aria-hidden="true" /></header>
        <div className="vela-dashboard-presets">{data.byPreset.map((row) => <div key={row.key}>
          <span>{presetLabels[row.key] || row.key}</span><strong>{row.successfulVideos} 条</strong><small>{formatDuration(row.gpuSeconds)} · {money.format(row.estimatedCostYuan)}</small>
        </div>)}</div>
      </article>

      <footer className="vela-dashboard-note">费用按当前 RTX PRO 6000 实例单价 {money.format(data.hourlyRateYuan)}/小时 × GPU 运行时间估算，不等同于 AutoDL 钱包账单；今日按北京时间和任务创建时间归档。最后更新 {updatedAt}。</footer>
    </>}
  </section>;
}
