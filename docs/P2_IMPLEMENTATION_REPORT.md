# Vela P2 本地数据与任务底座验收报告

> 日期：2026-08-06
> 结论：T020-T028 已完成，可以进入 P3 GPT 中转接入。

## 1. 本阶段完成内容

- 建立 Project、Node、Media、Profile、Job、JobGroup 的共享版本契约，当前 `schemaVersion=1`。
- 项目文件递归拒绝 `apiKey`、`token`、`secret`、`authorization`、`password` 等明文凭据。
- 项目采用临时文件、`fsync` 和原子改名保存；模拟写入中断时旧项目保持完整。
- 保留最近 20 个轻量快照；主文件损坏时自动恢复最近有效快照。
- 支持“仅工作流”和“包含素材”两种 `.vela` gzip 压缩包，素材逐文件保存 SHA-256 并在导入时校验。
- 使用 Node 内置 SQLite，建立 v1→v2 迁移、WAL、外键和完整同步策略。
- 实现批准的任务状态机、重启恢复判定和持久化事件记录。
- 实现 1/4/10/50 批量展开，单节点上限 50；固定、递增和可复现随机 Seed。
- 实现每个算力连接独立的并发槽；同连接受上限约束，不同连接可并行，离线连接继续排队。
- 实现项目、任务、批次、重试、取消和 SSE 事件 API。
- 前端项目面板接入新项目 API，自动保存改为 2 秒防抖。
- 前端任务中心改为读取 SQLite 快照并通过 SSE 接收增量事件。
- 新增递归日志脱敏器，对 Key、Bearer Token 和签名 URL 查询参数脱敏。
- 默认服务只监听 `127.0.0.1`；只有后续显式开启 LAN 模式才允许监听其他地址。

## 2. 默认本地目录

```text
%USERPROFILE%\Documents\Vela Projects\
└─ 项目名--短ID\
   ├─ project.json
   ├─ assets\
   ├─ outputs\images\
   ├─ outputs\videos\
   ├─ thumbnails\
   ├─ exports\
   └─ snapshots\

%LOCALAPPDATA%\Vela\
└─ database\vela.sqlite
```

测试和部署时可用 `VELA_PROJECTS_DIR`、`VELA_DATA_DIR` 覆盖路径。

## 3. 新 API

- `GET/POST /api/vela/projects`
- `GET/PUT /api/vela/projects/:id`
- `POST /api/vela/projects/import`
- `POST /api/vela/projects/:id/export`
- `GET/POST /api/vela/jobs`
- `GET /api/vela/jobs/:id`
- `POST /api/vela/jobs/:id/retry`
- `POST /api/vela/jobs/:id/cancel`
- `GET /api/vela/job-groups/:id`
- `POST /api/vela/job-groups/:id/retry-failed`
- `GET /api/vela/events`

## 4. 验证结果

| 验证 | 结果 |
|---|---|
| TypeScript | 通过 |
| 自动化测试 | 35 通过，0 失败 |
| 新建和 v1→v2 数据库迁移 | 通过 |
| 模拟断电原子保存 | 通过，旧文件保留 |
| 损坏项目快照恢复 | 通过 |
| `.vela` 工作流/素材往返与哈希 | 通过 |
| 4 条批量任务真实 HTTP 冒烟 | 全部 `succeeded` |
| 冒烟 Seed | 2026、2027、2028、2029 |
| 生产构建 | 通过 |
| 默认监听地址 | `127.0.0.1:3001` |

## 5. 当前边界

- P2 调度器只运行本地假任务；GPT 在 P3 接入，ComfyUI/H3 在 P4 接入。
- `prompt_id` 已有字段和恢复保护，但真正查询 ComfyUI 队列与历史在 P4/P5 完成。
- Profile 表和公开契约已建立；真实凭据加密需要 P3 Provider 和 P6 Electron `safeStorage` 配合。
- 旧 TwitCanva 的模型、工作流和素材接口仍保留为兼容层，后续逐阶段删除。
- 生产前端包仍约 2.1 MB，旧静态模块拆包继续列为优化项。
