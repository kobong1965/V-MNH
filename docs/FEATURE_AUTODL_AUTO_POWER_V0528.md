# Spec: AutoDL 无任务自动关机与任务自动开机（0.5.28）

## Objective

为现有 Vela Windows 桌面端的 AutoDL ComfyUI 算力连接增加安全的自动电源管理：当属于该算力 Profile 的 Vela 生成任务和远端 ComfyUI 队列都为空时，经过可配置的空闲等待时间自动关机；当新任务进入时，如果实例已关机，先通过 AutoDL 官方控制接口开机，等待 SSH、ComfyUI 与 MiniMax H3 工作流就绪，再提交任务。

第一版仅支持 AutoDL 官方公开的“容器实例 Pro”开发者接口。当前普通容器实例可以使用 SSH 执行自动关机，但关机后 SSH 不存在，不能依靠 SSH 自动开机；不得以网页登录 Cookie、浏览器自动点击或未公开内部接口替代官方控制接口。

## Assumptions Requiring Approval

1. 完整的“自动开机 + 自动关机”采用 AutoDL 容器实例 Pro，并配置开发者 Token 与 `pro-...` 实例 UUID；当前普通容器实例需要迁移或重新租用 Pro 实例。
2. 默认空闲关机等待时间为 5 分钟，可在 1–60 分钟范围调整；等待期间出现新任务立即取消关机。
3. 自动关机仅停止实例，不释放实例、不删除数据盘、不删除模型和输出。
4. 只有所选 AutoDL Profile 的本地活跃任务和远端 ComfyUI 队列都为空，且连续两次检查结果一致，才允许关机。
5. Vela 打开时负责自动开机、状态轮询和任务恢复；云端同时部署只负责空闲关机的保底脚本，避免 Vela 异常退出后实例持续计费。
6. AutoDL 开机失败、无空闲 GPU、接口限流或 ComfyUI 启动失败时，任务保持可重试并在节点和任务中心显示具体原因，不重复提交生成任务。
7. 实例连续关机接近 15 天时，Vela 显示 AutoDL 数据释放风险提示，但不自动开机或续期。

## Tech Stack

- React 19 + TypeScript + Vite 6：AutoDL Profile 的自动电源开关、空闲时长、实例状态与错误提示。
- Node.js + Express：AutoDL 控制客户端、任务/远端队列空闲判断、生命周期锁和状态轮询。
- Electron 43：沿用本地加密凭据存储、Windows 原位安装与现有桌面快捷方式。
- AutoDL Container Instance Pro API：状态查询、GPU 开机和关机。
- SSH + ComfyUI HTTP/WebSocket：开机后的启动脚本、健康检查、队列确认和真实生成任务。
- Node test runner：Provider、Profile、Runtime、竞态和凭据脱敏测试。

## Commands

- Test: `npm run test:node`
- Build: `npm run build`
- Dev: `npm run dev`
- Package Windows: `npm run build:win`
- Installed-app smoke test: 从现有 `D:\桌面\Vela AI视频画布.lnk` 启动并验证原用户数据与项目。

## Project Structure

- `server/providers/autodlPowerProvider.js`：封装官方状态、开机和关机接口，统一超时、限流和脱敏错误。
- `server/providers/autodlPowerProvider.test.js`：请求格式、状态映射、重试边界、错误脱敏和超时测试。
- `server/vela/cloudPowerManager.js`：每个 Profile 的生命周期锁、开机等待、空闲定时器、远端队列复核与关机。
- `server/vela/cloudPowerManager.test.js`：新任务取消关机、多任务并发、重复事件、重启恢复和失败状态测试。
- `server/vela/runtime.js`：提交 ComfyUI 任务前调用 `ensureReady`，任务结束后触发空闲评估。
- `server/vela/profileRepository.js`：保存公开的实例 UUID/策略，并把开发者 Token 合并进现有加密 secret；公开响应只返回是否已配置。
- `server/routes/vela-data.js`：Profile 保存、状态测试和手动刷新接口，不把 Token 返回到前端。
- `src/vela/services/profileService.ts`：新增自动电源配置与状态类型。
- `src/vela/components/VelaComfySection.tsx`：AutoDL Profile 中的自动开关机配置、状态、测试按钮和风险说明。
- `deploy/autodl-h3/`：云端 ComfyUI 启动脚本和空闲关机保底脚本。

## Code Style

沿用现有 ESM、显式校验、结构化错误、Profile 本地加密和界面风格。电源生命周期操作必须按 Profile 串行化，并在每次关机前重新读取真实任务/队列状态。

```js
await powerManager.withProfileLock(profile.id, async () => {
  if (await powerManager.hasAnyWork(profile.id)) return;
  await powerManager.powerOffIfStillIdle(profile);
});
```

不得在日志、项目文件、安装包、GitHub 或前端响应中输出 AutoDL Developer Token。

## Task Lifecycle

`任务入队 → 查询实例状态 → 必要时开机 → 等待实例运行 → 等待 SSH/ComfyUI/H3 就绪 → 提交工作流 → 生成/下载 → 本地与远端双重空闲确认 → 5 分钟缓冲 → 再次确认 → 关机`

- 多个任务同时入队只允许发出一次开机请求，其余任务等待同一个就绪 Promise。
- 已获得 ComfyUI `prompt_id` 的任务不得因开机轮询或网络未知状态重复提交。
- 空闲计时器期间新增任务必须同步取消关机，并等待正在进行的状态检查安全退出。
- Vela 重启后先恢复任务状态，再决定开机或进入空闲关机倒计时。
- 云端保底脚本只在 ComfyUI 无运行/排队任务、Vela 心跳已过期且达到更长空闲阈值时执行 `/usr/bin/shutdown`。

## UI Behaviour

- AutoDL 算力卡片增加“自动开关机”总开关，默认关闭，配置和测试成功后才能开启。
- 配置项包括：容器实例 Pro UUID、Developer Token（密码框，仅写入）、空闲关机分钟数、开机等待超时。
- 状态显示：运行中、正在开机、等待 ComfyUI、空闲倒计时、正在关机、已关机、异常。
- 节点生成时显示“正在启动云算力”和具体进度；失败显示官方接口或就绪检查的可操作原因。
- 开启前明确提示：自动开机会产生 GPU 计费；关机不等于释放实例；连续关机 15 天存在实例和数据释放风险。

## Testing Strategy

- Provider 单元测试：官方 URL、鉴权头、`instance_uuid`、`payload: gpu`、`start_command`、状态映射、429/5xx/超时和 Token 脱敏。
- Profile 测试：旧 Profile 向后兼容、Token 加密、更新不清空旧 Token、公开对象无明文凭据。
- Runtime 集成测试：关机状态下单任务自动开机、多任务共用开机、ComfyUI 就绪后仅提交一次、开机失败可重试。
- 竞态测试：倒计时中新任务、关机检查中新任务、Vela 重启、远端队列非空、本地任务已结束但下载未完成。
- 云端 smoke test：真实关机后从 Vela 新建 5 秒 H3 任务，自动开机并完成；随后保持无任务并验证按阈值关机。
- 桌面回归：API/算力页、画布生成、任务中心、弹窗、旧 Profile、项目素材、原安装位置和原快捷方式。

## Boundaries

- Always：使用 AutoDL 官方 API；关机前双重空闲复核；生成任务优先于关机；凭据加密和错误脱敏；保留用户数据与现有安装/快捷方式。
- Ask first：迁移或新租付费 Pro 实例、创建 Developer Token、首次启用自动开机、立即关闭正在计费的当前实例。
- Never：释放/删除实例或数据盘；在未知任务状态下关机；用网页 Cookie 或未公开接口自动开机；把 Token 写入源码/项目/日志/安装包/GitHub；在用户未要求时发布 GitHub Release。

## Success Criteria

1. 实例已关机时创建 H3 任务，只触发一次官方开机请求；实例与 ComfyUI 就绪后任务自动生成并下载。
2. 所有本地任务和远端队列连续为空达到配置时长后，实例只触发一次关机请求。
3. 空闲倒计时或关机前复核期间出现新任务，关机被取消且新任务正常执行。
4. 任一控制或网络失败都显示具体原因，任务可安全重试且不重复生成。
5. Developer Token 不出现在前端响应、日志、项目文件、安装包和测试快照中。
6. 自动化测试、构建、Windows 原位安装和真实“关机 → 新任务 → 开机 → 生成 → 空闲关机”闭环全部通过。
7. 版本按补丁升级到 0.5.28，原安装目录、桌面快捷方式、Profile、项目和素材保持不变。

## Open Gate

当前已租实例是普通容器实例，不是官方 API 要求的容器实例 Pro。用户需在以下两条路径中确认一条：

- 推荐：迁移/新租 AutoDL 容器实例 Pro，完成真正的自动开机和自动关机。
- 保持当前普通实例：仅实现可靠的自动关机；新任务出现时显示“实例已关机，请在 AutoDL 开机”，Vela 检测上线后自动继续，不能宣称全自动开机。
