# 批量图片工作流任务

- [x] 实现批次仓库和项目构建
  - Acceptance: 一个批次只创建一个持久化项目，每张图在该项目内创建一个独立的两节点图生图工作流分组。
  - Verify: `node --test server/vela/batchWorkflowStore.test.js`
  - Files: `server/vela/batchWorkflowStore.js`, `server/vela/batchWorkflowStore.test.js`, `server/vela/runtime.js`

- [x] 实现批次 API 与前端服务
  - Acceptance: 可创建、列表、读取、启动选择项和发布 Storyworks 同步清单。
  - Verify: `npx tsc --noEmit`
  - Files: `server/routes/vela-data.js`, `src/vela/services/batchWorkflowService.ts`

- [x] 实现批量工厂界面
  - Acceptance: 支持多图预览/移除、共享参数、批次勾选、批量开始、单项打开和一键同步。
  - Verify: `npx tsc --noEmit && npm run build`
  - Files: `src/vela/components/VelaBatchFactory.tsx`, `src/vela/components/VelaBatchFactory.css`, `src/vela/components/VelaHome.tsx`, `src/App.tsx`

- [x] 回归与交付检查
  - Acceptance: 全部 Node 测试通过，不修改既有数据，不在 D 盘生成新安装包。
  - Verify: `npm run test:node && npx tsc --noEmit && npx vite build --outDir E:\Codex工作盘\artifacts\test-builds\Vela-0.5.56-web --emptyOutDir`
  - Files: `tasks/todo.md`

- [x] 批量项目归类与新建入口
  - Acceptance: 首页“项目”和“批量工厂”分别展示普通项目与批量项目；批量页旧说明文字移除并提供“新建项目”。
  - Verify: `npx --no-install tsc --noEmit`
  - Files: `src/vela/components/VelaEcommerceWorkflows.tsx`, `src/vela/components/VelaBatchFactory.tsx`, `src/vela/components/VelaBatchFactory.css`, `src/vela/services/projectService.ts`

- [x] 生成结果回写画布
  - Acceptance: 批量任务完成后，项目图生图节点持久化结果 URL、100% 进度和成功状态；旧批次项目打开时自动修复。
  - Verify: `node --test server/vela/batchWorkflowStore.test.js server/routes/vela-data.test.js`
  - Files: `server/vela/batchWorkflowStore.js`, `server/routes/vela-data.js`, `server/vela/batchWorkflowStore.test.js`

- [x] 旧批次无损合并
  - Acceptance: 旧版四项目批次自动迁移成一个可见项目和四个独立分组；旧目录及任务记录保留但不再显示。
  - Verify: `node --test server/vela/batchWorkflowStore.test.js server/routes/vela-data.test.js`
  - Files: `server/vela/batchWorkflowStore.js`, `server/vela/batchWorkflowStore.test.js`

- [x] 集成构建与原位更新
  - Acceptance: 等待并整合并行开发的最新源码后，完整回归、在 E 盘打包并原位更新现有安装；快捷方式与用户数据保持不变。
  - Verify: 166 项 Node 测试、TypeScript、E 盘 Vite 构建均通过；安装后为 0.5.56，快捷方式不变，旧四项目批次已无损合并为一个项目与四个工作流分组。
  - Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, `tasks/todo.md`

- [x] 共享对标图输入
  - Acceptance: 新建批次可选一张对标图；素材仅持久化一次，每个分组包含带文字标注的商品原图/对标图节点，主图节点按固定顺序连接两者。
  - Verify: `node --test server/vela/batchWorkflowStore.test.js`
  - Files: `server/vela/batchWorkflowStore.js`, `server/vela/batchWorkflowStore.test.js`, `src/vela/services/batchWorkflowService.ts`

- [x] 姿势裂变后缀
  - Acceptance: 新批次可选择建立后缀节点并设置 2-10 张；节点只引用主图当前结果，使用 `pose-variation`，主图未完成时明确阻止生成。
  - Verify: `node --test server/vela/batchWorkflowStore.test.js server/vela/batch.test.js && npx tsc --noEmit`
  - Files: `server/vela/batchWorkflowStore.js`, `src/App.tsx`, `src/types.ts`

- [x] 批量工厂对标图与后缀配置界面
  - Acceptance: 支持对标图拖入、替换、移除及预览；支持开启后缀、编辑锁定提示词和选择裂变张数；320/768/1024/1440 宽度可用且键盘可操作。
  - Verify: `npx tsc --noEmit && npx vite build --outDir E:\Codex工作盘\artifacts\test-builds\Vela-0.5.57-web --emptyOutDir`
  - Files: `src/vela/components/VelaBatchFactory.tsx`, `src/vela/components/VelaBatchFactory.css`

- [x] 回归、审查与原位更新 0.5.57
  - Acceptance: 完整测试通过；安装路径、快捷方式、既有项目/批次/设置不变；现有安装从相同快捷方式打开后可见新功能。
  - Verify: 168 项 Node 测试、TypeScript、E 盘 Vite 构建通过；安装目录和桌面快捷方式均为 0.5.57，并已从原快捷方式实际启动检查对标图、姿势裂变、历史批次及 Storyworks 同步入口。
  - Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, `tasks/todo.md`

- [x] 多软件同步目标契约
  - Acceptance: 本机可读取已连接软件的安全摘要；服务端仅接受 Storyworks 或已连接的软件 ID，并分别保存同步清单。
  - Verify: `node --test server/vela/pairingService.test.js server/vela/batchWorkflowStore.test.js server/routes/vela-data.test.js`
  - Files: `server/vela/pairingService.js`, `server/vela/batchWorkflowStore.js`, `server/index.js`, `server/routes/vela-data.js`

- [x] 一键同步软件选择窗口
  - Acceptance: 点击一键同步后可多选 Storyworks 与已连接软件，支持刷新、记忆选择并显示逐目标结果。
  - Verify: `npx --no-install tsc --noEmit`，再手工覆盖空态、单选、多选、错误、深色和窄屏。
  - Files: `src/vela/components/VelaBatchFactory.tsx`, `src/vela/components/VelaSyncTargetsDialog.tsx`, `src/vela/components/VelaBatchFactory.css`, `src/vela/services/connectionService.ts`, `src/vela/services/batchWorkflowService.ts`

- [x] 多软件同步记录与回归
  - Acceptance: 旧 Storyworks 同步方式继续可用；已有项目、素材、批次和连接凭据不被改写。
  - Verify: 目标测试与 TypeScript 检查全部通过；核对 `CHANGELOG.md`。
  - Files: `CHANGELOG.md`, `tasks/todo.md`

- [x] GPT/Qwen 多图视觉提示词分析
  - Acceptance: 接口只使用用户选择的提示词或分析模型，接收 1-4 张产品图与可选对标图，返回可直接用于图生图的提示词和实际模型信息，且不泄露密钥。
  - Verify: `node --test server/providers/openAiCompatibleProvider.test.js server/routes/vela-data.test.js`
  - Files: `server/providers/openAiCompatibleProvider.js`, `server/vela/runtime.js`, `server/routes/vela-data.js`

- [x] 本机提示词模板库
  - Acceptance: 当前提示词可命名保存，列表可选择和删除，重启运行时后仍存在，写入使用原子替换。
  - Verify: `node --test server/vela/promptTemplateStore.test.js server/routes/vela-data.test.js`
  - Files: `server/vela/promptTemplateStore.js`, `server/vela/promptTemplateStore.test.js`, `server/vela/runtime.js`, `server/routes/vela-data.js`

- [x] 批量工厂提示词工作台
  - Acceptance: 支持选择已保存提示词、选择 GPT/Qwen 视觉模型、填写需求、分析前 4 张产品图与对标图、预览并确认采用；空态、错误态、窄屏和键盘操作可用。
  - Verify: `npx --no-install tsc --noEmit && npx vite build --outDir E:\Codex工作盘\artifacts\test-builds\Vela-0.5.60-web --emptyOutDir`
  - Files: `src/vela/components/VelaPromptWorkbench.tsx`, `src/vela/components/useVelaPromptWorkbench.ts`, `src/vela/components/VelaPromptWorkbench.css`, `src/vela/components/VelaBatchFactory.tsx`, `src/vela/services/batchWorkflowService.ts`

- [x] 审查、回归与原位更新 0.5.60
  - Acceptance: 全部测试通过；现有项目、提示词、设置、安装路径和快捷方式不变；同一快捷方式打开后可见并可操作新工作台。
  - Verify: 192 项 Node 测试、TypeScript、E 盘 0.5.60 生产构建均通过；代码审查修复了过期视觉分析结果覆盖问题；安装版从原快捷方式启动后已实际检查提示词库、智能分析展开/收起、无视觉模型引导和历史批次保留。
  - Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, `tasks/todo.md`
