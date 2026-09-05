# 多软件同步选择窗口规格

## Objective

在批量工厂底部点击“一键同步”时先打开目标选择窗口。用户可从 Storyworks 兼容通道和已经通过 Vela 连接码配对的软件中选择一个或多个目标，再执行同步，并查看每个目标的结果。

## Assumptions

- “自己做的多个软件”指设置页“外部软件连接”中已经配对的客户端。
- 首次使用默认只勾选 Storyworks，之后记住上次选择，避免升级后自动扩大同步范围。
- 同步发布的是当前批次清单，不覆盖目标软件已有项目、素材或任务。
- 单个目标失败不撤销其他已经成功写出的目标清单。

## Tech Stack

- React 19 + TypeScript 前端
- Express 本机服务
- 现有 `pairingService` 软件连接注册表
- 现有 `BatchWorkflowStore` 批次同步清单

## Commands

- Target tests: `node --test server/vela/pairingService.test.js server/vela/batchWorkflowStore.test.js server/routes/vela-data.test.js`
- Type check: `npx --no-install tsc --noEmit`
- Test build when needed: `npx --no-install vite build --outDir E:\Codex工作盘\artifacts\test-builds\Vela-multi-software-sync-web --emptyOutDir`

## Project Structure

- `src/vela/components/`：同步窗口与批量工厂入口
- `src/vela/services/`：连接信息与批次同步 API 类型
- `server/vela/`：配对客户端和分目标清单持久化
- `server/routes/`：同步目标解析与清单读取接口
- `tasks/`、`CHANGELOG.md`：规格、任务和用户可见变更

## Code Style

```ts
const selectedTargets = availableTargets.filter((target) => selectedIds.has(target.id));
if (!selectedTargets.length) throw new Error('请至少选择一个同步软件');
```

- 保留现有中文文案、原生控件和 `vela-batch__*` 命名。
- 目标只保存公开 ID、名称、类型和同步时间，不保存访问令牌。
- 新弹窗拆为独立组件，避免继续扩大批量工厂主组件。

## Testing Strategy

- 单元测试：配对客户端安全列出、目标清单分别写入、旧 Storyworks 清单兼容。
- 路由测试：多目标同步、未知目标拒绝、按客户端读取清单。
- TypeScript：前后端响应类型和组件属性。
- 手工验收：无连接、单选、多选、部分失败、深色模式、窄屏和键盘关闭。

## Boundaries

- Always: 复用现有配对客户端；校验目标 ID；保留旧 Storyworks 接口；不返回令牌哈希。
- Ask first: 增加远程推送 URL、保存第三方凭据、修改外部软件协议之外的业务数据。
- Never: 自动选择所有新连接软件；删除旧清单；覆盖用户项目或素材；把访问令牌写进同步清单。

## Success Criteria

- 一键同步先打开窗口，不再立即同步。
- 窗口列出 Storyworks 和所有已连接软件，支持多选、全选和刷新。
- 确认后每个目标得到独立清单，界面展示成功或失败结果。
- 已配对的远程软件只能读取分配给自己的同步清单。
- 旧 Storyworks 无参数读取方式和历史数据继续可用。

## Open Questions

- 将来若某个软件要求 Vela 主动推送而不是拉取清单，需要再为该软件增加回调地址和独立认证配置；本次不保存这类敏感信息。
