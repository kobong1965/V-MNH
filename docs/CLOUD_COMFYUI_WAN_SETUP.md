# AutoDL / ComfyUI Wan 后端部署与 API 接入

这份说明用于复现 Vela 的两条“保留原视频动作”处理链。应用前端只上传源视频和角色图；完整 ComfyUI UI 工作流由本地 Vela 服务读取、注入素材、发送到远端 `/workflow/convert`，再把转换后的 API prompt 提交到 `/prompt`。

## 代码与数据边界

GitHub 中包含两份 UI 工作流、无密钥部署脚本、固定转换器版本、模型/节点清单和 API 代码。真实 API Key、AutoDL Developer Token、SSH 私钥、项目和素材只能通过设置页的密码加密迁移包转移，不能提交仓库。

## 已有 AutoDL 环境（推荐）

如果原 Wan 工作流已经能在云端 ComfyUI 手动运行，只需安装转换端点、同步工作流并验证：

```bash
cd /root/autodl-tmp
git clone https://github.com/kobong1965/V-MNH.git vela-app
bash vela-app/deploy/autodl-wan/install-converter.sh
bash /root/autodl-tmp/vela-h3/deploy/start-comfy.sh
bash vela-app/deploy/autodl-wan/sync-workflows.sh vela-app/server/ecommerce-workflows
bash vela-app/deploy/autodl-wan/verify.sh
```

若仓库目录已存在，先 `git pull --ff-only`，不要把 Token 写进克隆命令、shell 历史或配置文件。

若是新环境或验证提示缺少节点/模型，按下面的完整顺序执行。节点和转换器都固定到已验证提交；模型从 ModelScope 上的 Kijai / Comfy-Org 镜像下载，并按官方文件 SHA-256 校验：

```bash
cd /root/autodl-tmp/vela-app
bash deploy/autodl-wan/install-nodes.sh
bash deploy/autodl-wan/install-converter.sh
bash deploy/autodl-wan/install-models.sh
bash /root/autodl-tmp/vela-h3/deploy/start-comfy.sh
bash deploy/autodl-wan/sync-workflows.sh server/ecommerce-workflows
bash deploy/autodl-wan/verify.sh
```

模型下载支持断点续传。若运行地区能直接高速访问其他合法镜像，可用 `MODEL_ENDPOINT` 覆盖默认的 `https://modelscope.cn/models`。

## 新 AutoDL 环境

1. 先按 `deploy/autodl-h3/` 安装 ComfyUI、Python 环境和安全启动脚本。
2. 运行 `install-nodes.sh`、`install-converter.sh` 和 `install-models.sh`；仓库只保存来源与校验值，不重新分发权重。
3. 运行上面的工作流同步和验证命令。
4. ComfyUI 只监听 `127.0.0.1:6006`；Windows Vela 通过 SSH 隧道映射到 `127.0.0.1:18188`，不要把 6006/8188 裸露到公网。

两份工作流引用的关键模型：

- `Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors`
- `Wan2_1_VAE_bf16.safetensors`
- `umt5-xxl-enc-fp8_e4m3fn.safetensors` / `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `clip_vision_h.safetensors`
- `lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
- `WanAnimate_relight_lora_fp16.safetensors`
- `dw-ll_ucoco_384_bs5.torchscript.pt`
- `yolox_l.onnx`
- `segformer_b2_clothes/{config.json,preprocessor_config.json,model.safetensors}`
- `vitmatte/{config.json,preprocessor_config.json,model.safetensors}`

## Vela ComfyUI Profile

公开、可迁移字段包括：`baseUrl`、`websocketUrl`、SSH 主机/端口/用户名、本地与远端端口、启动脚本路径、AutoDL 实例 UUID、并发数和空闲关机时间。敏感字段包括 ComfyUI Token、AutoDL Developer Token 和 SSH 私钥内容，仅存在本机加密存储或密码加密迁移包。

推荐值：

```text
baseUrl: http://127.0.0.1:18188
websocketUrl: ws://127.0.0.1:18188/ws
transport: ssh
sshLocalPort: 18188
sshRemoteHost: 127.0.0.1
sshRemotePort: 6006
sshStartScript: /root/autodl-tmp/vela-h3/deploy/start-comfy.sh
maxConcurrency: 1
```

## API 流程

1. `POST /api/vela/projects/:id/media` 保存前端图片/视频。
2. `POST /api/vela/jobs` 创建 `nodeKind=wan-video-process` 任务，携带固定 `ecommerceWorkflowId` 和语义化 `workflowInputs`。
3. Vela 读取当前项目媒体并上传 ComfyUI `/upload/image`（VideoHelperSuite 也使用该上传入口）。
4. Vela 只修改清单中固定的 LoadImage / VHS_LoadVideo 节点。
5. `POST /workflow/convert` 转换完整 UI 图；`POST /prompt` 提交。
6. WebSocket 与 `/history/{prompt_id}` 跟踪执行，`/view` 下载结果到项目。

MiniMax H3 新视频生成仍走独立的 `h3-video` API prompt，不经过上述 Wan UI 图。

## 换电脑

1. 从 GitHub Releases 安装最新 Vela。
2. 原电脑“设置 → 跨电脑加密迁移”导出 `.vela-backup`。
3. 用独立渠道把迁移包和密码带到新电脑，并在同一设置区导入。
4. 应用会把 SSH 私钥写入新电脑的 Vela 数据目录并自动重写 Profile 路径；测试 API/算力连接后即可使用。

迁移包不能上传公开 GitHub。若云端实例已删除或模型/节点不完整，导入配置不会自动重建数百 GB 模型，需要按本说明重新部署。
