# Spec: 前端输入画布与后端电商工作流执行

## Objective

将 10 个唯一电商工作流作为后端能力接入 Vela。前端不再展示或复制完整 ComfyUI 节点图，只保留用户必须填写的图片、视频、文字输入节点和一个执行/结果节点；用户上传素材后，本地服务负责持久化、校验、选择运行引擎并提交到后端。

## Confirmed engine routing

- 8 个作图工作流统一使用现有 GPT 图片中转节点（`gpt-image`）。
- 2 个必须保留原视频动作的处理型工作流继续使用原 Wan ComfyUI 图：视频换脸/换装、视频人物角色替换。
- 其余新增视频生成统一使用 MiniMax H3（`h3-video`）。
- Wan UI 工作流保存在后端；运行前将用户输入按固定角色写入指定 LoadImage/VHS_LoadVideo 节点，再通过远端 ComfyUI 工作流转换接口生成 API prompt。

## User-facing contracts

- 图片输入：只接受图片 MIME，上传后保存为项目媒体。
- 视频输入：只接受视频 MIME，上传后保存为项目媒体。
- 文本输入：只显示该工作流真正需要用户填写的提示词。
- 执行节点：显示明确的引擎标签、提交状态、错误和最终结果，不暴露模型加载、采样器、解码器等后端节点。
- 删除工作流：只在本机工作流库隐藏条目，不删除打包 JSON、下载原文件或已有项目。

## Backend workflow inputs

| 工作流 | 引擎 | 前端必填输入 |
| --- | --- | --- |
| 视频换脸+换装 | Wan ComfyUI | 源视频、角色/服装参考图 |
| 视频人物角色替换 | Wan ComfyUI | 动作参考视频、待驱动角色图 |
| 人物多视角生成 | GPT 图片中转 | 人物参考图、视角要求 |
| 高精度姿态重绘 | GPT 图片中转 | 人物图、姿态/重绘要求 |
| 老照片修复上色 | GPT 图片中转 | 老照片、修复要求 |
| 产品溶图打光 | GPT 图片中转 | 产品图、背景/光线参考图、要求 |
| 一键详情页 | GPT 图片中转 | 产品图、风格参考图、要求 |
| 精准换装 | GPT 图片中转 | 模特图、服装图、要求 |
| 人物换背景 | GPT 图片中转 | 人物图、背景描述 |
| FILL Redux 换装 | GPT 图片中转 | 模特图、服装图、要求 |

## Portable update and migration

- GitHub 保存应用源码、10 个后端工作流、云算力安装脚本、模型/端口/启动参数说明、API 数据结构和安装包更新文件。
- GitHub 不保存明文 API Key、AutoDL Token、SSH 密码/私钥、用户素材或项目数据库。
- 应用提供密码加密迁移包：导出公开配置、加密后的敏感配置、相关 SSH 私钥和项目/媒体；另一台电脑安装更新后导入一次即可恢复。
- 加密包使用 scrypt 派生密钥与 AES-256-GCM；密码不保存、不上传，导入时重新输入。

## Commands

- Development: `npm run dev`
- Build: `npm run build`
- Node tests: `npm run test:node`
- Windows package: `npm run build:win`

## Boundaries

- Always: 校验输入角色与 MIME；保留现有项目、安装目录、快捷方式和用户材料；补丁版本递增；提交前扫描敏感信息。
- Ask first: 实际启动计费云实例进行远端端到端验证；删除用户原始文件；上传任何包含真实秘密或用户素材的数据包。
- Never: 把完整 ComfyUI 图暴露为前端编辑节点；把外部 JSON 当作代码执行；把明文秘密提交 Git/GitHub；拉伸图片来伪造目标画幅。

## Success criteria

- 首页只显示 10 个唯一工作流，卡片预览为精简输入画布。
- 创建任意工作流后，前端仅包含必要输入节点和一个执行/结果节点。
- 8 个作图工作流提交到 GPT 图片中转；2 个处理型视频工作流提交到 Wan ComfyUI；普通视频节点继续提交 MiniMax H3。
- Wan 运行时能按角色注入图片/视频并对缺失转换插件、节点、素材给出可操作错误。
- 本地测试覆盖清单、精简画布、路由、Wan 注入/转换与加密迁移；构建通过。
- 原桌面安装原位升级并保留快捷方式和数据；GitHub 更新不含明文敏感信息。

## Remote ComfyUI prerequisites

- 安装原 Wan 工作流使用的模型与自定义节点。
- 安装 `comfyui-workflow-to-api-converter-endpoint`，提供 `/workflow/convert`。
- 将两份 Wan UI JSON 放入后端工作流目录；Vela 也会随应用打包并在运行时发送副本。
- 远端输入和输出目录必须可写；Vela 只通过配置好的 ComfyUI HTTP/SSH 接口访问。
