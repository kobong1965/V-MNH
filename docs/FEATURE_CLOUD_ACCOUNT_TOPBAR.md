# Spec: 云端账户顶部栏与无边框桌面窗口

## Objective

在 V-MNH 的首页、API/设置页和画布页上方提供统一的云端账户顶部栏，显示 AutoDL 账号余额、个人镜像仓库入口和官方充值入口；Windows 桌面版移除系统原生标题栏，并把最小化、最大化/还原、关闭按钮放入新顶部栏右侧。

## Assumptions

- “云端”指当前软件已经支持并加密保存 Developer Token 的 AutoDL 算力账户。
- “个人仓库”指 AutoDL 私有镜像列表，不是本机素材盘或 GitHub 仓库。
- 软件不处理付款；“充值”仅打开 AutoDL 官方页面。
- 未配置 AutoDL 时顶部栏仍可用，并显示“未绑定”及配置入口。

## Tech Stack

- React 19 + TypeScript + Vite
- Electron 43（无边框 BrowserWindow、预加载桥接、IPC）
- Express 本机服务 + AutoDL Developer API

## Commands

- Type check: `npx.cmd tsc --noEmit`
- Test: `npm.cmd run test:node`
- Build: `npm.cmd run build`
- Windows package: `npm.cmd run build:win`

## Project Structure

- `electron/`：桌面窗口创建、窗口控制 IPC 与安全预加载桥接
- `server/providers/`：AutoDL 钱包与私有镜像 API 客户端
- `server/routes/`、`server/vela/`：本机只读云账户聚合接口
- `src/vela/components/`：顶部栏、账户弹层和样式
- `src/vela/services/`：云账户前端请求服务

## Code Style

```tsx
<button type="button" aria-label="最小化窗口" onClick={windowControls.minimize}>
  <Minus aria-hidden="true" />
</button>
```

- 使用现有 V-MNH 中性色与青色强调色，不引入新的视觉体系。
- 所有图标按钮提供可见提示或 `aria-label`，桌面拖拽区内的交互控件必须使用 `no-drag`。

## Testing Strategy

- 单元测试 AutoDL 钱包/镜像请求路径、结果换算和错误脱敏。
- 单元测试桌面窗口 IPC：最小化、最大化切换和关闭（关闭沿用现有托盘后台策略）。
- 路由测试确认未配置、正常和上游部分失败时均返回可渲染结果。
- TypeScript、Node 全量测试和 Vite 生产构建必须通过。
- 安装后从原桌面快捷方式启动，确认项目资料与安装路径保持不变。

## Boundaries

- Always：只读 AutoDL 余额/镜像；Token 仅在后端解密使用；保留网页模式。
- Ask first：新增支付、代充值、删除云镜像或修改云账户资料。
- Never：把 Developer Token 返回前端、写入日志或上传 GitHub Release（本次未授权）。

## Success Criteria

- Windows 桌面版不再显示系统标题栏和 File/Edit/View 菜单。
- 新顶部栏在首页、API/设置页和画布页一致显示。
- 顶部栏包含充值、个人仓库、账号余额三个入口。
- 已配置 AutoDL 时余额和个人镜像可刷新；接口局部失败不会让整个应用白屏。
- 最小化、最大化/还原、关闭按钮均可键盘操作，关闭继续遵循现有“隐藏到托盘”行为。
- 网页版不显示桌面窗口控制按钮，布局不溢出。

## Open Questions

- 无阻塞问题；后续若接入非 AutoDL 平台，可在相同顶部栏下增加平台切换。
