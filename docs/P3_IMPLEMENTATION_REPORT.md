# Vela P3 GPT 中转阶段报告

日期：2026-08-06

## 当前结论

YMAN 的管理网页地址可以使用大写 `/V1`，但 OpenAI 兼容 API 基址必须使用小写：

`https://api.yman.cc/v1`

未带 Key 的只读/空请求验证结果：

- `GET /v1/models` 返回 `401 API_KEY_REQUIRED`，路由存在。
- `POST /v1/chat/completions` 返回 `401 API_KEY_REQUIRED`，路由存在。
- `POST /v1/images/generations` 返回 `401 API_KEY_REQUIRED`，路由存在。
- `POST /v1/images/edits` 返回 `401 API_KEY_REQUIRED`，路由存在。
- 服务明确接受 `Authorization: Bearer <API_KEY>`；Vela 第一版固定使用该方式。

## 已实现

- GPT Profile 增删改查、账户别名和模型映射。
- AES-256-GCM 静态加密；项目、节点、任务、日志和公开 API 不保存或返回 Key。
- 连接测试自动读取 `/models`，区分地址错误、401/403、模型不存在、超时和供应商故障。
- 提示词优化，支持纯文本和当前项目内的一张可选参考图。
- GPT 单图、参考图编辑与节点批量任务。
- 输出立即下载到项目 `outputs/images`，写入 `media-index.json` 并计算 SHA-256。
- GET 型安全请求可对 429/5xx/超时做退避重试；可能产生重复费用的 POST 生图请求不自动重提。
- 画布侧边栏新增“账户与算力连接”：默认 YMAN 地址，Key 密码输入，保存后读取并选择模型。
- 节点只显示账户名称；任务成功后图片 URL 或优化文本自动回填节点。

## 验证结果

- TypeScript：通过。
- 自动化测试：40 项通过。
- Vite 生产构建：通过。
- 生产包仍有约 556 KB gzip 的旧代码分包警告；不阻塞 P3 联调，后续单独优化。

## 尚未完成的真接口验收

还需要用户提供一个可用的 YMAN API Key。Key 保存进软件即可，不应粘贴到聊天、项目文件或代码中。连接成功后从模型列表选择：

1. 一个支持 Chat Completions/视觉输入的提示词模型。
2. 一个支持 Images Generations/Edits 的图片模型。

然后执行一次提示词优化、一次单图生成和一次参考图生成，才能正式关闭 T032/T033 和 P3。

## 安全边界

当前开发版用本机随机主密钥加密 Profile，主密钥位于 Vela 数据目录并限制为当前用户文件。P6 打包 Electron 时会把主密钥保护层迁移到 Windows DPAPI / Electron `safeStorage`；迁移不改变画布和 Profile API。
