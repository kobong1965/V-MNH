# Spec: Akamai MiniMax-H3 云算力、Turbo 加速与 RTX 高清

## Objective

在现有 Vela Windows 桌面画布中接入 Akamai Cloud（Linode）RTX PRO 6000 Blackwell 云算力，部署本地权重版 MiniMax-H3 + ComfyUI，并让现有 H3 视频节点完成真实的文生视频、图生视频和参考生成。节点内提供 Turbo 加速、SageAttention 与 RTX Video Super Resolution 高清选项，任务中心显示提交、排队、采样、超分、下载和失败原因。

本规格以用户提供的抖音教程为功能参考，但以 Akamai、ComfyUI、模型仓库和节点仓库的当前官方实现为准。视频中“不开防火墙”和密码式远程管理不纳入实现。

验收场景：

- Vela 的算力/API 页面新增 Akamai H3 预设，可保存 ComfyUI 连接、SSH 隧道和可选的 Akamai 实例标识。
- 现有 `h3-video` 节点不再走假任务，能提交标准 ComfyUI `/prompt`，经 WebSocket、`/queue`、`/history` 恢复状态并下载结果。
- 支持文生视频、首帧/尾帧图生视频以及 H3 参考生成；第一版画布入口优先开放文生视频与图生视频，参考视频/音频作为高级模式。
- 加速提供三个清晰预设：标准 20 步、Turbo 8 步（质量优先）、Turbo 4 步（速度优先）。不继续固化教程里较早的 6 步参数。
- SageAttention 作为服务端可检测的启动优化；不支持或编译失败时自动退回 PyTorch attention，并显示实际启用状态。
- 高清提供关闭、RTX 2 倍、RTX 4 倍；节点显示基础分辨率、预计输出分辨率和当前阶段。
- 云实例完成真实 5 秒文生视频与 5 秒图生视频各一条，并完成至少一条 4 倍超分结果。
- 保留现有 GPT/Boundless/ComfyUI Profile、API Key、项目素材、安装位置和桌面快捷方式。

## Confirmed Source Facts

- Akamai 单卡 RTX PRO 6000 Blackwell 为 96 GB GDDR7 ECC、16 vCPU、176 GB RAM、1024 GB SSD，当前公开起价为 2.50 USD/小时，有限区域可用。
- GPU 计费按实例“存在时间”计算并向上取整到小时；仅关机仍计费，删除实例才停止继续计费。
- 官方 ComfyUI H3 工作流已提供 T2V、I2V、R2V，基础输出 24 fps、最长约 15 秒，并带原生音频解码链。
- T2V/I2V 使用 `minimax_h3_fl2va_pruned_int8_convrot.safetensors`；R2V 使用独立的 `minimax_h3_ref2va_pruned_int8_convrot.safetensors`。
- 官方当前工作流已包含 8 步和 4 步 Turbo LoRA；R2V 当前提供 4 步 Turbo LoRA。
- NVIDIA RTX Nodes 的 `RTXVideoSuperResolution` 支持图片/视频超分，只适用于 NVIDIA RTX GPU；运行前必须做驱动和 NvVFX 自检。
- T2V/I2V 基础模型、双 VAE、NVFP4 文本编码器和一个 Turbo LoRA 约需 42 GiB；连同 R2V 权重和 LoRA 约需 64 GiB，另需预留输出、缓存和安装空间。

## Assumptions Requiring Approval

1. 云平台采用 Akamai Cloud 单卡 RTX PRO 6000 Blackwell，优先新加坡；若该区无库存，再选择东京/大阪/雅加达，而不是教程面向印度市场使用 Chennai。
2. 首次真实部署允许产生至少 1 个计费小时，即最低约 2.50 USD；新账户还可能被要求 100 USD 押金。
3. Vela 第一版同时实现“连接已有实例”和“查看/启动/关机”；“停止计费”必须走备份校验后删除实例，并再次输入实例名确认，不提供无确认的一键删除。
4. ComfyUI 不公开暴露 8188 端口。Vela 通过 SSH 密钥隧道访问 `127.0.0.1:8188`；云防火墙只允许受限 SSH 入站。
5. 先以官方 H3 工作流和官方 Turbo LoRA 为稳定基线；SageAttention 与 RTX VSR 只有通过该实例真机自检后才在节点中标为“可用”。

## Tech Stack

- React 19 + TypeScript + Vite 6：H3 节点、算力配置、状态与参数交互。
- Node.js + Express + WebSocket：ComfyUI HTTP/WebSocket 客户端、任务恢复与媒体下载。
- Electron 43：Windows 本机凭据、SSH 隧道与桌面安装。
- Ubuntu 24.04 + NVIDIA open driver + CUDA 12.8：Akamai Blackwell 运行环境。
- ComfyUI stable/nightly 固定提交、Python venv、systemd：可重复部署与自动重启。
- Nginx 仅用于服务端健康页和后续 HTTPS 扩展；ComfyUI API 默认只监听回环地址。
- Node test runner + 真机 smoke test：Provider、Runtime、工作流映射、恢复和真实生成。

## Commands

本地工程：

- Test: `npm run test:node`
- Build: `npm run build`
- Dev: `npm run dev`
- Package Windows: `npm run build:win`

云端验收脚本（实施阶段新增）：

- Install: `sudo /opt/vela-h3/deploy/install.sh`
- Verify GPU: `sudo /opt/vela-h3/deploy/verify-gpu.sh`
- Verify models/nodes: `sudo /opt/vela-h3/deploy/verify-comfy.sh`
- Service status: `systemctl status vela-comfy`
- Smoke workflow: `/opt/vela-h3/deploy/smoke-test.sh`

## Project Structure

- `deploy/akamai-h3/`：cloud-init、固定版本清单、安装/升级/自检/备份脚本和 systemd 配置。
- `server/providers/comfyUiProvider.js`：上传、`/prompt`、WebSocket、队列、历史、结果下载与结构化错误。
- `server/providers/akamaiProvider.js`：可选的实例只读状态、启动、关机和经二次确认的删除接口。
- `server/vela/h3WorkflowRepository.js`：版本化工作流、节点白名单和参数映射。
- `server/workflows/minimax-h3/`：T2V、I2V、R2V、Turbo 与 RTX 超分 API 工作流 JSON。
- `server/vela/runtime.js`：持久化 `prompt_id`、阶段进度、断线恢复、防重复计费提交和结果下载。
- `server/vela/profileRepository.js`：Akamai/ComfyUI Profile、密钥路径和可选云 API Token 的本机加密保存。
- `src/types.ts`、`src/vela/nodeCatalog.ts`：H3 模式、时长、基础像素、加速、高清和状态类型。
- `src/vela/components/VelaComfySection.tsx`：Akamai 预设、算力状态、环境自检和生命周期操作。
- `src/vela/components/VelaInspector.tsx`、`VelaNodeControls.tsx`：H3 参数与可用性约束。
- 同目录 `*.test.js`：协议、参数、恢复、凭据脱敏与回归测试。

## Code Style

- 沿用当前 ESM、显式校验、结构化 `ProviderError` 和现有界面风格。
- 工作流只允许替换白名单节点/字段，不接受客户端上传任意可执行工作流。
- 远端任务创建后先原子保存 `prompt_id` 再轮询；网络未知状态不得自动重复创建付费任务。
- UI 的模式、速度和高清选项均显示实际服务端能力；不可用选项禁用并给出原因。
- Akamai Token、SSH 私钥和 ComfyUI Token 只保存在本机加密存储中，不进入项目、日志、安装包或 GitHub。

## Deployment Design

### Compute and security

1. 创建单卡 `g3-gpu-rtxpro6000-blackwell-1` Ubuntu 24.04 实例并绑定 Cloud Firewall。
2. 使用 Vela 专用 ED25519 公钥登录，不启用密码自动化；SSH 只允许当前用户 IP。
3. ComfyUI 监听 `127.0.0.1:8188`，由 Vela 建立 SSH 隧道；不向公网开放未鉴权的 ComfyUI。
4. 驱动、CUDA、PyTorch、ComfyUI 和自定义节点均固定版本，升级先在 smoke test 通过后切换。
5. 模型存放于独立持久目录；输出下载完成后才允许备份/销毁。

### H3 workflow presets

- Standard：20 步，无 Turbo LoRA；用于质量基准和故障回退。
- Turbo Balanced：8 步 + FL2V Turbo LoRA；作为 T2V/I2V 默认值。
- Turbo Fast：4 步 + 768p Turbo LoRA；速度优先。
- R2V Turbo：4 步 R2V LoRA；参考模式单独显示，不把 FL2V LoRA 混用。
- Base quality：0.4 MP（16:9 约 864×480）快速预览；0.7 MP（约 1152×640）高清源。
- RTX HD：输出链可选关闭、2×、4×，保留原生音频并重新封装视频。

### Task lifecycle

`upload → submit → queued → sampling → decoding → upscaling → downloading → completed`

- WebSocket 提供实时节点/百分比；断线时由 `/queue` 和 `/history/{prompt_id}` 恢复。
- 每个阶段独立显示错误原因，并区分网络、鉴权、缺模型、缺节点、显存、工作流和下载错误。
- 取消只终止仍在队列中的任务；已进入 GPU 采样后明确提示是否能中断。
- 应用或电脑重启后继续追踪已保存的 `prompt_id`，不会重复提交。

### Cost controls

- 任务提交前显示基于实例小时价和历史耗时的估算，不宣称固定每秒成本。
- 新实例创建前显示当前计划、地区、官方小时价和“最低按一小时计费”确认。
- “关机”旁明确标注“仍计费”。
- “停止计费”执行：检查无运行任务 → 确认结果已下载 → 可选创建恢复镜像 → 用户输入实例名 → 删除实例。

## Testing Strategy

- Provider 单元测试：上传、提交、prompt id、WebSocket 事件、队列/历史恢复、结果下载、超时、幂等和错误脱敏。
- Workflow 测试：T2V/I2V/R2V 参数白名单；4/8/20 步切换；基础像素与 2×/4×尺寸映射；音频链保留。
- Profile/Akamai 测试：旧 Comfy Profile 向后兼容；云 Token/SSH 私钥不出现在序列化数据、日志或安装包。
- Runtime 集成测试：重启恢复、WebSocket 断开、下载失败、取消、实例准备销毁和重复点击提交。
- 云端自检：`nvidia-smi`、CUDA/PyTorch、SageAttention、ComfyUI `/system_stats`、`/object_info`、模型哈希、RTX VSR。
- 真机矩阵：5 秒 T2V、5 秒 I2V、Turbo 8、Turbo 4、0.4 MP、0.7 MP、2×、4×各覆盖；记录耗时、峰值显存、结果大小和错误。
- 桌面验收：`npm run test:node`、`npm run build`、Windows 打包、原位安装、原快捷方式、旧数据与 Profile 读取。

## Boundaries

- Always：先查当前价格/区域/库存；使用防火墙和密钥；提交后持久化 `prompt_id`；下载完成后再允许销毁；显示真实错误；保留现有安装和用户数据。
- Ask first：创建任何付费 GPU、产生押金、删除云实例/镜像、上传用户素材到额外第三方、发布 GitHub Release。
- Never：把云 API Token、SSH 私钥或 API Key 写入源码/安装包/GitHub；公网裸露 8188；在未知提交结果时自动重试创建付费任务；把“关机”描述成停止计费；删除本地项目素材。

## Success Criteria

1. Akamai Profile 能检测 GPU、显存、ComfyUI、模型、Turbo LoRA、SageAttention 和 RTX VSR 的真实状态。
2. H3 节点完成真实 T2V/I2V 提交、进度、恢复、下载和画布播放；失败显示上游具体原因。
3. Turbo 8、Turbo 4、RTX 2×、RTX 4×都由固定 API 工作流执行，输出音频不丢失。
4. 任一网络断开或应用重启不会重复创建付费任务；恢复后可继续下载历史结果。
5. “关机仍计费”和“删除停止计费”在界面及确认框中无歧义。
6. 所有自动化测试、构建、云端 smoke test、Windows 原位安装和主要页面回归通过。

## Open Questions / External Gates

- Akamai/Linode 账户当前仍需完成登录/验证，并创建可用付款方式；GPU 计划可能额外要求 100 USD 押金。
- 创建实例前必须由用户确认当前区域、2.50 USD/小时价格和至少一个计费小时。
- RTX VSR 在 Blackwell Linux 驱动上的实际可用性必须以目标实例 smoke test 为准；若 NvVFX 不兼容，Vela 保留高清选项但标记不可用，并提供独立的非 RTX 超分替代规格供后续批准。
- Akamai 的删除会永久移除实例磁盘。自动“停止计费”功能必须先完成外部镜像/清单备份并经过二次确认。
