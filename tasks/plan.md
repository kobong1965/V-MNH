# AutoDL Pro 自动电源管理实施计划

## 目标

在 Vela 0.5.28 中为 AutoDL Container Instance Pro 接入官方状态、开机、关机接口，实现“任务自动唤醒、空闲自动关机”，并保持当前安装位置、快捷方式、用户 Profile、项目和素材不变。

## 依赖顺序

1. 固化 Profile 数据模型和密钥边界。
2. 实现 AutoDL 官方电源 Provider，并完成协议测试。
3. 实现 CloudPowerManager 的并发锁、空闲计时和双重队列复核。
4. 把生命周期接入 ComfyUI Runtime 与恢复流程。
5. 在算力设置中加入配置、状态和测试交互。
6. 创建 AutoDL Pro 实例、Developer Token，并迁移 H3 环境和模型。
7. 自动化测试、构建、原位安装和真实闭环验收。

## 风险与缓解

- GPU 无库存或开机慢：状态轮询有明确超时，任务保留可重试，不重复提交。
- 关机与新任务竞态：每个 Profile 串行生命周期锁，关机前二次读取本地任务和远端队列。
- Vela 异常退出导致持续计费：云端部署更长阈值的空闲保底关机脚本。
- Token 泄露：合并进入现有 encrypted_secret，公开对象仅返回已配置状态，测试日志脱敏。
- 模型迁移时间和磁盘：保留现有实例，在 Pro 真机完成模型校验和生成后再单独确认是否释放旧实例。
- 现有脏工作区：只补充本功能文件并小范围修改相关模块，不覆盖用户已有改动。

## 验证检查点

- Checkpoint A：Provider/Profile 测试通过，公开 API 无 Token。
- Checkpoint B：PowerManager/Runtime 竞态测试通过，任务不重复提交。
- Checkpoint C：前端构建通过，设置项可保存、测试、显示状态。
- Checkpoint D：Pro 实例 H3/ComfyUI 健康检查通过。
- Checkpoint E：真实关机后发起 5 秒 H3 任务，完成自动开机、生成、下载和空闲关机。
- Checkpoint F：0.5.28 原位安装后从原桌面快捷方式启动，旧数据完整。

## 外部确认点

- 在 AutoDL 页面点击最终“租用/创建实例”前，展示当前价格和配置并获取确认。
- 创建 Developer Token 前获取确认。
- 释放旧普通实例或删除任何云端数据前另行获取确认。
