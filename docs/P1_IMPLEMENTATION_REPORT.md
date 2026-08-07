# Vela P1 实施与验收报告

> 日期：2026-08-06
> 基线：TwitCanva `9705b26411710d688d68e0ae93169961c13ce90a`
> 结论：P1 低保真画布与第一版节点外壳完成，可以进入 P2 本地数据与任务底座。

## 1. 已完成

- 建立 Vela 中文品牌壳和语义化视觉令牌：Carbon、Slate、Mist、Amber、Signal Blue。
- 建立顶部项目栏、左侧节点栏、中央无限画布、右侧节点属性、底部任务中心、算力抽屉和小地图。
- 普通入口只保留 7 类节点：提示词、图片输入、GPT 提示词优化、GPT 图片、H3 视频、图片结果、视频结果。
- 新增 TEXT、IMAGE、VIDEO、IMAGE_LIST、VIDEO_LIST 端口类型与兼容性校验。
- 新版节点使用独立精简控制条，只显示账户别名、描述、生成数量和开始生成，不显示真实 Key。
- 隐藏聊天、社交发布、本地模型及其他首版外入口；旧代码暂留在底层，后续按阶段删除。
- 保留框选、多选、复制、删除、撤销/重做，新增自动整理和节点小地图。
- 增加 GPT 图片和 H3 视频假 Provider，可在不配置任何 Key、ComfyUI 或云算力时演示完整画布链。
- 增加 200 节点开发性能夹具：`?velaFixture=200`，仅在开发模式启用。

## 2. 验证结果

| 验证 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | 通过 |
| Provider + 端口规则测试 | 8 通过，0 失败 |
| Vite 生产构建 | 通过 |
| GPT 假图片 HTTP 冒烟 | `succeeded / fake-image` |
| H3 假视频预览 HTTP 冒烟 | `succeeded / fake-h3-video / previewOnly=true` |
| 1366×768 低保真布局 | 通过，无重叠和横向溢出 |
| 1920×1080 低保真布局 | 通过，无重叠和横向溢出 |
| 200 节点固定场景 | 成功渲染，小地图 200，任务中心识别生成节点 133 |

截图：

- `output/playwright/vela-1366x768.png`
- `output/playwright/vela-1920x1080.png`
- `output/playwright/vela-200-nodes.png`

## 3. 已知问题与后续边界

1. 生产 JS 仍约 2.1 MB（gzip 约 555 KB）。原因是旧版编辑器、社交、聊天和多 Provider 模块仍被静态导入；P2/P3 建立新数据层后应改为按需加载并逐步删除。
2. 200 节点目前一次性挂载，尚未做视口虚拟化；固定场景能渲染，但更大画布可能出现拖动帧率下降。后续应加入节点视口裁剪、连接索引和正式 FPS 采样。
3. Playwright CLI 在本机 Windows 运行时出现 Node/UV 断言，浏览器安装步骤也长时间无输出；本次截图改用已安装的 Edge Headless。需要在后续 E2E 门禁前单独修复 Playwright 环境。
4. H3 假 Provider 只返回带播放标识的 SVG 预览，不是真视频；真实 H3 视频在 P4 接入云端 ComfyUI 后验证。
5. P1 的任务中心和算力抽屉是 UI 外壳，可靠队列、SQLite、恢复和多连接调度从 P2 开始实现。

## 4. 下一阶段入口

P2 首先定义 Project、Node、Media、Profile、Job、JobGroup 的共享 Schema，然后实现本地项目目录、原子自动保存、SQLite 迁移和任务状态机。P2 不需要真实 GPT Key 或 ComfyUI，因此可以直接继续。
