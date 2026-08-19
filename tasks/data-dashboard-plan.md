# Vela 数据台实施计划

1. 在 JobRepository 建立 H3 每日用量聚合，依赖现有 `jobs` 和 `job_events`。
2. 在 Runtime 组合 AutoDL 账户余额，通过只读路由输出统一数据合约。
3. 增加前端 service 与独立 dashboard component，再接入 VelaHome 导航。
4. 完成 Node 测试、Vite 构建、数据复核与桌面端 smoke test。
5. 将补丁版本从 0.5.34 升至 0.5.35，原位更新现有安装。

## Risks

- 任务跨零点：本版按 createdAt 归档，在界面标注口径。
- 正在运行的任务：成本计算到刷新时刻，不写入数据库。
- 余额网络失败：本地统计与账户警告分开显示。
- 现有脏工作区：只改数据台相关文件，不覆盖其他未提交更改。
