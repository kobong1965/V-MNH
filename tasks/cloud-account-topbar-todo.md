# 云端账户顶部栏任务

- [x] AutoDL 钱包余额和私有镜像 API
  - Acceptance：Token 只在后端使用，金额按官方单位换算为元。
  - Verify：Provider 单元测试。
- [x] 云账户聚合路由与前端服务
  - Acceptance：返回未配置、可用、部分失败三类稳定结构。
  - Verify：路由测试与 TypeScript。
- [x] 全局顶部栏与账户仓库弹层
  - Acceptance：首页、设置和画布均显示三个入口，深浅主题可读。
  - Verify：生产构建与桌面人工检查。
- [x] 无边框窗口和窗口控制
  - Acceptance：原生标题栏消失，最小化/最大化/关闭可用，网页模式安全降级。
  - Verify：IPC 单元测试和桌面人工检查。
- [x] 原路径升级验证
  - Acceptance：同一快捷方式启动新版本，项目和用户资料保留。
  - Verify：安装版本、快捷方式目标和项目目录检查。
