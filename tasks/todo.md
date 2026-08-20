# AutoDL Pro 自动电源管理任务

- [ ] Task 1: 扩展 AutoDL Comfy Profile 数据模型与加密凭据
  - Acceptance: 可保存 Pro UUID、自动电源策略和 Developer Token；公开响应无明文 Token；旧 Profile 可读。
  - Verify: `node --test server/vela/profileRepository.test.js server/routes/vela-data.test.js`
  - Files: `server/vela/profileRepository.js`, `server/routes/vela-data.js`, `src/vela/services/profileService.ts`, 对应测试。

- [ ] Task 2: 实现 AutoDL Pro 官方电源 Provider
  - Acceptance: 支持 status/power_on/power_off，正确鉴权、超时、状态映射和错误脱敏。
  - Verify: `node --test server/providers/autodlPowerProvider.test.js`
  - Files: `server/providers/autodlPowerProvider.js`, `server/providers/autodlPowerProvider.test.js`。

- [ ] Task 3: 实现 CloudPowerManager
  - Acceptance: 多任务共用一次开机；空闲倒计时可取消；本地/远端双重空闲确认；一次关机。
  - Verify: `node --test server/vela/cloudPowerManager.test.js`
  - Files: `server/vela/cloudPowerManager.js`, `server/vela/cloudPowerManager.test.js`, `server/vela/scheduler.js`。

- [ ] Task 4: 接入 Comfy Runtime 和恢复流程
  - Acceptance: 提交前自动确保实例/ComfyUI 就绪；完成/失败/取消后评估空闲；不重复提交 prompt。
  - Verify: `node --test server/vela/comfyRuntime.test.js server/vela/runtime.test.js`
  - Files: `server/vela/runtime.js`, `server/providers/comfyUiProvider.js`, 对应测试。

- [ ] Task 5: 完成 AutoDL 算力设置 UI
  - Acceptance: 可配置开关、UUID、Token、空闲分钟、开机超时；可测试连接；状态和风险说明清晰。
  - Verify: `npm run build`，主页面人工回归。
  - Files: `src/vela/components/VelaComfySection.tsx`, `src/vela/components/VelaApiSettings.tsx`, `src/vela/services/profileService.ts`, `src/vela/libtv.css`。

- [ ] Task 6: 创建 Pro 实例并部署 H3
  - Acceptance: Pro 实例可由官方 API 控制；ComfyUI、H3 模型和现有 SSH 安全配置通过健康检查。
  - Verify: AutoDL 状态 API、SSH 健康检查、ComfyUI `/system_stats` 和工作流 smoke test。
  - Files: `deploy/autodl-h3/`。

- [ ] Task 7: 闭环测试与原位安装 0.5.28
  - Acceptance: 真实自动开机生成 5 秒视频并在空闲后关机；所有测试/构建通过；原快捷方式和数据保留。
  - Verify: `npm run test:node`, `npm run build`, `npm run build:win`，从 `D:\桌面\Vela AI视频画布.lnk` 启动验证。
  - Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, QA 文档和截图。
