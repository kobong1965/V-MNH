# TwitCanva 上游审计与 P0 可行性结论

> 审计日期：2026-08-06
> 审计分支：`codex/p0-audit`
> 结论：**继续基于 TwitCanva 改造画布，不重写画布；生成、任务、存储和设置层按 Vela 架构重做。**

## 1. 冻结信息

- 仓库：`https://github.com/SankaiAI/TwitCanva-Video-Workflow.git`
- 上游分支：`main`
- 冻结提交：`9705b26411710d688d68e0ae93169961c13ce90a`
- 提交时间：`2026-07-08T19:16:31-07:00`
- 提交说明：`Fix star history link in README`
- 许可证：Apache License 2.0
- `LICENSE` SHA-256：`01C36F532A6ECE69304FE71AFFD6BDC947D44FF8FAD63EE235E8A4D296289679`
- `NOTICE` SHA-256：`C9D0803790A19831A55E524175A790CE2E595900B0199B249208351395CD6B78`
- `package-lock.json` SHA-256：`AD8AEC6EAC6506F024E0ADB28BE8A6BEA9CE572436964B4EFC16D77696CD9388`

由于完整仓库包含较多演示媒体，第一次完整克隆超过 2 分钟并超时。最终采用 `--depth 1 --filter=blob:none` 加稀疏检出，只拉取 `src`、`server`、`config`、`docs`、`scripts`、`modal` 和根文件。生产构建不依赖缺失的演示媒体，因此审计与开发不受影响；需要公共工作流或品牌素材时再按目录补取。

## 2. 环境与基线验证

| 项目 | 结果 |
|---|---|
| Git | `2.55.0.windows.3` |
| Node.js | `v24.18.0` |
| npm | `11.17.0`，通过 `npm.cmd` 调用 |
| `npm ci` | 通过，安装 894 个包 |
| `npm run build` | 通过，Vite 转换 16021 个模块 |
| 前端开发服务 | `http://127.0.0.1:5173` 返回 HTTP 200 |
| 后端开发服务 | 端口 3001 成功监听 |
| 严格类型检查 | 未通过，只有 1 个已知错误 |

严格类型检查错误：

```text
src/services/cameraAngleService.ts(32,36): error TS2339:
Property 'env' does not exist on type 'ImportMeta'.
```

依赖安装还有一个 Peer Dependency 警告：`@emoji-mart/react@1.1.1` 只声明支持 React 16～18，而项目锁定 React 19.2.1。当前构建可通过，但 P1 删除聊天/表情相关界面后应一并移除此依赖链。

默认生产主 JavaScript 包约 2.12 MB，gzip 后约 556 KB，Vite 提示超过 500 KB。P1 删除无关模型、3D、聊天和编辑器代码后重新测量；暂时不先做手工拆包。

## 3. 当前代码结构

### 3.1 前端主路径

```text
App.tsx
  ├─ useNodeManagement          节点和选中状态
  ├─ useConnectionDragging      连线和类型校验
  ├─ useHistory                 撤销/重做
  ├─ useWorkflow                JSON 工作流保存/读取
  ├─ useGeneration              收集父节点输入并决定图/视频生成
  ├─ generationService          请求固定的生成 API
  ├─ useGenerationRecovery      按 nodeId 轮询本地结果文件
  └─ CanvasNode/NodeControls    节点渲染、模型列表和参数规则
```

### 3.2 后端主路径

```text
server/index.js
  ├─ 启动 Express、创建 library 目录、加载环境变量
  ├─ 工作流/素材/聊天/工具等大量内联路由
  └─ /api → routes/generation.js
                 ├─ 按模型名前缀选择 Provider
                 ├─ 等待第三方生成完整结束
                 ├─ 下载结果到 library
                 └─ 用 nodeId 写 JSON 元数据供简单恢复
```

## 4. 规模与耦合证据

最大文件：

| 文件 | 行数 | 主要问题 |
|---|---:|---|
| `src/components/canvas/NodeControls.tsx` | 1414 | 模型注册、参数能力、状态和 UI 混在一个组件 |
| `src/App.tsx` | 1402 | 所有面板、画布、生成、编辑器和社交功能集中编排 |
| `server/index.js` | 1228 | 配置、存储、API、聊天、工具、媒体处理混合 |
| `src/components/canvas/CanvasNode.tsx` | 938 | 多种节点特殊逻辑堆叠 |
| `src/hooks/useGeneration.ts` | 389 | 图遍历、模型特殊规则、请求、媒体解析和错误文案混合 |
| `server/routes/generation.js` | 397 | 用字符串前缀路由模型，HTTP 请求一直等待第三方完成 |

主要耦合点：

1. `NodeData` 同时包含通用画布字段、Kling、Veo、Hailuo、本地模型、编辑器和故事板字段，无法安全增加 H3/任务批次。
2. `NodeStatus` 只有 idle/loading/success/error，不能表达排队、提交、运行、重连、下载和取消。
3. `NodeControls.tsx` 内硬编码 `VIDEO_MODELS`、`IMAGE_MODELS` 和能力规则；配置没有由 Provider 能力驱动。
4. `useGeneration.ts` 直接遍历节点、拼提示词、判断具体模型、调用 API、提取视频尾帧和回写节点。
5. 后端 `generation.js` 用 `startsWith('kling-')`、`startsWith('hailuo-')` 选择 Provider，无法通过 Profile/账户别名选择实例。
6. 原生成接口是长请求：第三方任务全部完成后才返回。它不能满足云 ComfyUI `prompt_id`、持久队列和断线恢复。
7. 当前恢复只检查 `library/images|videos/{nodeId}.json`，没有独立 Job、批次、远程任务 ID 或状态机。
8. 项目保存到一个同步写入的 JSON 文件；自动保存默认每 60 秒，没有临时文件、原子替换、迁移和快照。
9. 前端多处硬编码 `http://localhost:3001`，不适合 Electron 动态端口和局域网部署。
10. 服务固定端口 3001、全局开放 CORS、JSON Body 上限 100 MB，局域网模式前必须收紧。

## 5. 可复用部分

### 5.1 直接保留并逐步整理

- 画布坐标、缩放、平移和节点拖动。
- 节点框选、多选和分组基础。
- 撤销/重做的交互入口。
- 连线拖动、连接线渲染和父节点关系表达。
- 图片/视频节点的预览与媒体工具栏思路。
- 工作流 JSON 中节点、组、视口的基本表达。
- Express + Vite 的本地开发组合。

### 5.2 复用外观行为，但必须抽象

- 节点参数面板：改成节点 Schema + Provider 能力渲染。
- 连接校验：从 `NodeType` 特判改成端口类型规则。
- 生成按钮：只提交 Job，不直接等待模型完成。
- 自动保存：保留 Hook 入口，替换存储和保存策略。
- 历史恢复：保留用户入口，替换为 Job/ComfyUI 恢复器。

## 6. 必须重做部分

- Provider 契约和账户 Profile。
- GPT 中转适配器。
- ComfyUI HTTP/WebSocket 适配器。
- H3 固定工作流和能力表。
- SQLite Job/JobGroup、并发调度和任务状态机。
- `prompt_id` 持久化、断线恢复、下载重试。
- 项目目录、原子自动保存、快照、导入导出。
- 凭据加密、日志脱敏和局域网鉴权。
- Electron 生命周期、托盘和动态端口。

## 7. 第一版移除/隐藏候选

- Gemini、Veo、Kling、Fal 和 Hailuo 商业 API 入口。
- LangGraph 聊天、表情组件和聊天历史。
- Twitter/X、TikTok 发布与导入。
- 本地模型、Python 推理和相机角度控制。
- Storyboard、图片编辑器、视频剪辑器。
- React Three Fiber/Three.js 相关相机组件。

“移除”必须先通过入口隐藏和构建验证，再分批删除依赖，禁止一次删除全部代码。

## 8. P0 假 Provider 纵向原型

为验证画布生成链能脱离真实 GPT/Gemini/Kling/Hailuo，新增了开发专用的 `FakeImageProvider`：

- 不访问网络，不读取 API Key。
- 接收提示词和比例，生成带提示词的 SVG 占位图片。
- 通过新的 `/api/vela/generate-image` 路由保存到本地 `library/images`。
- 设置 `VITE_VELA_FAKE_PROVIDER=true` 时，现有图片节点前端服务改走 Vela 假接口。
- 默认构建仍走原接口，因此不会改变未启用原型时的上游行为。

测试结果：

```text
node --test server/providers/fakeImageProvider.test.js
tests 2 | pass 2 | fail 0
```

真实 HTTP 纵向验证：

```text
POST /api/vela/generate-image
prompt: 9:16 夏季产品展示，镜头从近景缓慢拉远

status: succeeded
provider: fake-image
asset HTTP status: 200
content-type: image/svg+xml
```

启用假 Provider 的生产构建通过，并确认产物包含 `/api/vela/generate-image`。

## 9. 推荐改造顺序

1. P1 先删除界面入口，不立即删除底层文件。
2. 把通用 `CanvasNodeBase`、端口和边从模型字段中拆出。
3. 把模型能力表从 `NodeControls.tsx` 移到共享契约。
4. 把假 Provider 扩成统一 Job API，节点只关心 Job ID。
5. 建立 SQLite 和状态机后，再接 GPT/ComfyUI。
6. 真 Provider 稳定后删除旧 generation route 和旧模型依赖。
7. 最后做 Electron、局域网和高保真 UI。

## 10. P0 决策结果

**用户已于 2026-08-06 确认“继续改造 TwitCanva”。**

理由：画布导航、拖动、选择、连线、分组、预览和工作流基础已经存在，重写会重复投入；同时生成和存储耦合虽然明显，但边界集中在 `useGeneration`、`generationService`、`NodeControls` 和后端 generation route 附近，可以通过纵向切片逐步替换。假 Provider 已证明无需真实模型也能保留画布生成链。

P1 不应继续往现有 `NodeData` 和 `NodeControls.tsx` 追加 H3 字段。应先建立 Vela 节点契约和 Provider 能力层，否则后续每增加一个模型都会继续放大耦合。

P1 已据此完成低保真中文外壳、第一版节点契约和假 Provider 纵向链，详见 `docs/P1_IMPLEMENTATION_REPORT.md`。

## 11. 当前未执行的动作

- 未提交、未推送、未创建 PR。
- 未配置任何真实 Key。
- 未连接 GPT、ComfyUI 或云算力。
- 未修改 `velorn-zh-CN`。
- 未开始 P2 本地数据与任务底座。
