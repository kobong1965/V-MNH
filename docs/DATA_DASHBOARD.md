# Spec: Vela 数据台与 H3 消耗统计

## Objective

在 Vela 桌面端主导航新增“数据台”，使用本机任务数据库与 AutoDL 账户接口，集中展示当前余额、今日 H3 成片数、各分辨率数量与 GPU 成本。取代 Codex 中的 `vela-h3` 定时巡检，不依赖后台自动化也能在软件内随时查看。

### Acceptance criteria

- 侧边栏有键盘可访问的“数据台”入口，不改变现有首页、API 和设置。
- 展示 AutoDL 可用余额、累计消费、最后刷新时间与读取错误。
- 今日按 Asia/Shanghai 时区且按任务 `createdAt` 归档。
- 今日成片数仅统计 `h3-video` 且状态为 `succeeded` 的任务；失败和活跃任务单独展示。
- 费用按进入 `running` 到离开 `running` 的 GPU 时间乘以 ¥7.97/小时估算；运行中任务计算到当前时间。
- 按 480p/720p/1080p/2K 展示成功数、失败数、成片时长、GPU 时间和估算费用；同时补充 4/8/20 步预设分布。
- 页面提供手动刷新，仅在数据台打开时每 30 秒自动刷新；不自动提交、重试、取消任务或开关机。

## Tech Stack

- Electron 43 + React 19 + TypeScript + Vite 6
- Express 5 + Node `node:sqlite`
- 现有 Vela SQLite `jobs` / `job_events` / `profiles` 表，不增加数据库迁移

## Commands

- Node tests: `npm run test:node`
- Frontend build: `npm run build`
- Windows package: `npm run build:win`
- Desktop smoke run: `npm run desktop`

## Project Structure

- `server/vela/jobRepository.js` → H3 任务时间与成本聚合
- `server/vela/runtime.js` → 组合账户余额与今日用量
- `server/routes/vela-data.js` → 数据台只读 API
- `src/vela/services/dataDashboardService.ts` → 前端数据合约
- `src/vela/components/VelaDataDashboard.tsx` → 数据获取与页面编排
- `src/vela/components/VelaDataDashboard.css` → 遵循现有 Vela 主页设计系统

## Code Style

```ts
export async function fetchDataDashboard(): Promise<VelaDataDashboard> {
  const response = await fetch('/api/vela/data-dashboard');
  if (!response.ok) throw new Error('无法读取数据台');
  return response.json() as Promise<VelaDataDashboard>;
}
```

- 服务端使用小型纯聚合函数与参数化 SQL，字段使用 camelCase 对外输出。
- React 组件与数据服务分离，使用语义标题、真实按钮和 `role="status"` / `role="alert"`。

## Testing Strategy

- Repository unit test: 成功、失败、运行中任务成本与分辨率分组。
- Route integration test: 返回余额、今日数据，不泄露 Developer Token。
- TypeScript/Vite build: 数据合约、路由并查集和 CSS 引用通过。
- Desktop smoke: 首页、数据台、API、设置可切换，窗口无白屏和溢出。

## Boundaries

- Always: 数据来自本地 SQLite 与已有 AutoDL 账户服务；保留原安装位置、快捷方式和用户数据。
- Ask first: 增加外部依赖、改变¥7.97/小时口径、上传 GitHub。
- Never: 在数据台里提交或重试任务、开关云算力、暴露密钥、删除历史任务。

## Success Criteria

- 从原桌面快捷方式打开更新后的 0.5.35，用户数据不变。
- 数据台显示的成功数、分辨率分组、GPU 时间和费用与 `vela.sqlite` 人工复核一致。
- 余额接口失败时仍显示本地任务统计和明确错误，不白屏。

## Open Questions

- None. 当前用户请求已确认上述口径。
