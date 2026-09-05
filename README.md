# V-MNH · Vela AI 视频画布

当前版本：`0.5.62`

Vela 是一套 Windows 桌面 AI 图片与视频生产画布。本机服务负责项目、素材、任务、加密凭据和云端算力调度；前端只展示用户需要操作的节点。

## 当前能力

- GPT 兼容中转：提示词、图片生成与参考图编辑。
- MiniMax H3 Ref2VA：使用人物、场景和道具多参考图生成视频，保持画面比例，不拉伸输入素材。
- 双 AutoDL GPU：两张算力卡可并行执行，任务到达自动开机，独立空闲后自动关机。
- Storyworks：通过动态本机地址和一次性配对码连接，导入项目后自动进入短剧板块。
- 本地持久化：项目、素材、任务、余额状态和加密 API 凭据在关闭重开后继续保留。
- 批量图片工作流：一次上传多张图片，在一个项目内为每张图建立独立图生图工作流，支持 GPT/Qwen 视觉分析提示词、本机提示词库、批量开始、选择 Storyworks 或“小红书素材盘”同步、结果回写和首页分类。
- 数据台：查看 H3 任务、分辨率、GPU 时长、估算成本和 AutoDL 余额。

## 本地开发

要求：Windows 10/11、Node.js 22 或更高版本、npm。

```powershell
npm ci
npm run test:node
npx tsc --noEmit
npm run dev
```

## 构建桌面版本

```powershell
npm run build:win
```

当前桌面版本已原位更新到 `E:\Codex项目盘\Vela AI视频画布\Vela AI视频画布.exe`。桌面快捷方式和用户数据目录保持不变。

## 云端与 API

- AutoDL H3 部署脚本：`deploy/autodl-h3/`
- 自动开关机说明：`docs/AUTODL_H3_AUTO_POWER.md`
- 云端账户顶部栏：`docs/FEATURE_CLOUD_ACCOUNT_TOPBAR.md`
- API、设置与更新：`docs/FEATURE_SETTINGS_API_UPDATER.md`
- 数据台：`docs/DATA_DASHBOARD.md`

真实 Developer Token、API Key、数据库、项目素材和生成结果不进入源码仓库。

## 用户数据

- 项目：`%USERPROFILE%\Documents\Vela Projects`
- 账户、任务与加密凭据：`%APPDATA%\Vela AI视频画布\data`
- 素材库：`%APPDATA%\Vela AI视频画布\library`

项目基于 SankaiAI/TwitCanva-Video-Workflow 改造，许可证见 `LICENSE` 与 `NOTICE`。
