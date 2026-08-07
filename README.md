# V-MNH

V-MNH 是一套面向团队内部使用的 AI 图片与视频无限画布。前端采用接近 LibTV 的节点式操作方式，本机后端负责保存项目、管理任务、保护 API 凭据，并连接 GPT 中转站或云端 ComfyUI。

当前版本：`v0.4.0`

## v0.4 已完成

- Windows Electron 桌面端，同时保留网页运行方式
- 中文无限画布、节点连接、缩放、自动整理和本地项目保存
- GPT 兼容中转账户管理，支持提示词模型与图片模型
- API Key 仅传给本机后端并加密保存
- 图片生成、参考图编辑、任务排队、失败重试和历史恢复
- 多任务批量提交与任务中心
- 云端 ComfyUI 连接档案
- AutoDL、RunPod 和通用 ComfyUI 平台预设
- 无鉴权、Bearer Token、Basic Auth 和安全白名单请求头
- `/system_stats`、`/queue` 与 WebSocket 全面连接检测
- 显卡、显存、运行队列和等待队列状态展示

## 尚未完成

- MiniMax H3 固定工作流的正式提交、进度同步和结果下载
- H3 云端模型与自定义节点自动体检
- 图片分辨率与不同中转站参数的完整映射

这些功能将在获得验证通过的云端 H3 工作流与模型目录后继续开发。

## 本地开发

要求：Windows 10/11、Node.js 22 或更高版本、npm。

```powershell
git clone https://github.com/kobong1965/V-MNH.git
cd V-MNH
npm ci
npm run dev
```

开发模式默认启动：

- 前端：`http://127.0.0.1:5173`
- 本机控制服务：`http://127.0.0.1:3001`

## 构建 Windows 安装包

```powershell
npm ci
npm run test:node
npx tsc --noEmit
npm run build:win
```

安装包生成在 `release/`，该目录不会提交到 Git，正式安装包通过 GitHub Releases 发布。

## 数据与密钥

- 桌面版账户、项目和任务数据保存在 Windows 用户目录中，不进入源码仓库。
- GPT 与 ComfyUI 凭据使用 AES-256-GCM 加密后保存在本机。
- `.env`、数据库、项目素材、模型、生成结果、安装包和测试浏览器数据均已加入 `.gitignore`。
- 请勿把真实 API Key、Token 或云端访问凭据写入源码和 Issue。

## 技术结构

- 前端：React 19、TypeScript、Vite
- 桌面端：Electron
- 本机后端：Express、Node.js SQLite
- 任务通信：REST、SSE、ComfyUI WebSocket
- 图片模型：OpenAI 兼容接口
- 视频算力：标准 ComfyUI API

详细规格见 [docs/VELA_PROJECT_SPEC.md](docs/VELA_PROJECT_SPEC.md)。

## 上游与许可证

本项目基于 [SankaiAI/TwitCanva-Video-Workflow](https://github.com/SankaiAI/TwitCanva-Video-Workflow) 改造，并保留原项目的 Apache License 2.0 与 NOTICE。V-MNH 的新增代码和修改继续遵循仓库中的 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
