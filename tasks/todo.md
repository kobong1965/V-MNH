# Vela 第一版任务清单（已审批）

> 每项任务控制在一个专注开发会话内。
> `[ ]` 未开始，`[~]` 进行中，`[x]` 完成。P0、P1、P2 已完成。

## Gate 0：规格审批

- [x] T000 用户审批 `docs/VELA_PROJECT_SPEC.md`
  - Acceptance：用户明确回复“规格确认，可以开始”，或列出需修改内容。
  - Verify：在规格头部记录批准日期和版本。
  - Files：`docs/VELA_PROJECT_SPEC.md`、`tasks/plan.md`、`tasks/todo.md`

## P0：源码审计

- [x] T001 获取并冻结 TwitCanva 上游
  - Acceptance：记录正确仓库 URL、提交 SHA、分支、许可证和依赖锁文件。
  - Verify：`git status` 干净；`LICENSE`、`NOTICE` 存在。
  - Files：仓库根配置、`docs/UPSTREAM_AUDIT.md`

- [x] T002 跑通上游开发与构建
  - Acceptance：前后端可启动，生产构建成功，记录所有警告。
  - Verify：`npm ci`、`npm run dev`、`npm run build`。
  - Files：不修改业务代码；只补审计记录。

- [x] T003 画布依赖与数据流审计
  - Acceptance：列出画布、节点、Provider、素材和存储的耦合点及复用结论。
  - Verify：依赖图能覆盖一次假生成完整路径。
  - Files：`docs/UPSTREAM_AUDIT.md`

- [x] T004 制作假 Provider 纵向原型
  - Acceptance：提示词节点生成假图片结果，完全不依赖现有外部模型。
  - Verify：手动演示并通过最小组件测试。
  - Files：不超过 5 个，审计后填写。

- [x] T005 提交 P0 评审
  - Acceptance：用户选择“继续改造”或“重写外壳并复用算法/数据结构”。
  - Verify：决策写回规格和计划。
  - Files：规格、计划、审计报告。

## P1：画布与节点外壳

- [x] T010 建立 Vela 品牌壳和中文文案系统
  - Acceptance：导航、菜单、错误、空状态不再散落英文硬编码。
  - Verify：中文快照测试和人工巡检。
  - Files：文案目录、应用壳、主题令牌。

- [x] T011 隐藏第一版范围外入口
  - Acceptance：Gemini/Kling/Fal/社交发布/聊天/本地模型不出现在普通界面。
  - Verify：E2E 菜单巡检；生产包不调用这些接口。
  - Files：路由、菜单、节点注册表、配置。

- [x] T012 定义节点端口和连线校验
  - Acceptance：TEXT/IMAGE/VIDEO/列表端口可判定兼容性并显示中文错误。
  - Verify：单元测试覆盖合法与非法组合。
  - Files：共享类型、端口规则、连线交互、测试。

- [x] T013 实现提示词与图片输入节点
  - Acceptance：可编辑文本、拖入图片、显示本地预览和输出端口。
  - Verify：组件测试和手动拖放。
  - Files：两个节点、媒体导入服务、测试。

- [x] T014 实现 GPT/H3/结果节点壳
  - Acceptance：可用假 Provider 串联完整路径，属性栏显示对应参数。
  - Verify：E2E 假生成流程。
  - Files：节点壳、属性面板、注册表、测试。

- [x] T015 完成画布效率操作
  - Acceptance：框选、多选、复制、删除、撤销/重做、小地图、自动整理可用。
  - Verify：快捷键和交互 E2E 测试。
  - Files：画布控制器、快捷键、历史栈、测试。

- [x] T016 建立主界面低保真布局
  - Acceptance：左节点栏、中央画布、右属性栏、任务抽屉、算力抽屉位置稳定。
  - Verify：1366×768 和 1920×1080 截图评审。
  - Files：应用壳、布局样式、抽屉组件、测试。

- [x] T017 画布性能基线
  - Acceptance：200 个假节点缩放拖动达到规格目标或记录瓶颈。
  - Verify：固定场景性能记录。
  - Files：性能夹具、报告。

## P2：本地数据与任务底座

- [x] T020 定义共享 Schema 和版本策略
  - Acceptance：项目、节点、媒体、Profile、Job、JobGroup 均有严格 Schema 和版本。
  - Verify：合法/非法 Fixture 单元测试。
  - Files：`packages/contracts`、测试。

- [x] T021 实现项目目录和原子自动保存
  - Acceptance：2 秒防抖保存；断电模拟不会留下半写文件。
  - Verify：集成测试模拟写入中断和恢复。
  - Files：项目存储、自动保存 Hook、API、测试。

- [x] T022 实现快照、导入和导出
  - Acceptance：可恢复最近快照；支持仅工作流/含素材两种导出。
  - Verify：导出后重新导入并比对节点、边和素材哈希。
  - Files：快照服务、导入导出 API、测试。

- [x] T023 建立 SQLite 与迁移框架
  - Acceptance：新建、升级、回滚失败保护可用。
  - Verify：空库和旧版本 Fixture 迁移测试。
  - Files：数据库初始化、迁移、仓储层、测试。

- [x] T024 实现任务状态机
  - Acceptance：只允许规格中的合法状态转换，重启后状态保留。
  - Verify：状态矩阵单元测试和崩溃恢复集成测试。
  - Files：状态机、Job 仓储、测试。

- [x] T025 实现批次展开与 Seed 策略
  - Acceptance：节点数量展开为独立子任务；固定/递增/随机可复现。
  - Verify：1、4、10、50 条 Fixture 测试。
  - Files：批次服务、Seed 工具、测试。

- [x] T026 实现每连接并发调度器
  - Acceptance：同连接遵守并发上限，不同连接可并行，离线保持等待。
  - Verify：虚拟时钟调度测试。
  - Files：调度器、连接容量接口、测试。

- [x] T027 实现事件推送与任务抽屉数据层
  - Acceptance：页面刷新后获取快照，运行中接收增量更新。
  - Verify：断开/重连事件集成测试。
  - Files：事件服务、API、前端 Store、测试。

- [x] T028 日志与秘密脱敏
  - Acceptance：Token、Authorization、Key 和签名 URL 不进入日志。
  - Verify：自动秘密扫描测试。
  - Files：日志配置、脱敏器、测试。

## P3：GPT 中转

- [x] T030 实现 GPT Profile 安全存储
  - Acceptance：节点只读取名称和 ID，敏感值由系统加密存储。
  - Verify：数据库/项目/日志明文扫描。
  - Files：Profile 仓储、安全模块、API、测试。

- [x] T031 实现 GPT 连接测试和契约 Fixture
  - Acceptance：能区分地址错误、鉴权失败、模型不存在和超时。
  - Verify：模拟服务集成测试。
  - Files：GPT Provider、Fixture Server、测试。

- [ ] T032 接入提示词优化
  - Acceptance：输入文本/可选图片，返回可编辑优化结果并记录来源。
  - Verify：真接口一次 + 模拟错误矩阵。
  - Files：Provider 方法、节点动作、任务映射、测试。
  - Status：代码与模拟错误矩阵已完成；等待 YMAN API Key 和实际提示词模型名做真接口验收。

- [ ] T033 接入 GPT 图片生成和本地下载
  - Acceptance：单图、参考图、批量输出写入当前项目。
  - Verify：真接口和文件哈希检查。
  - Files：Provider、媒体下载、节点结果、测试。
  - Status：单图、参考图、批量、本地文件与哈希模拟测试已完成；等待 YMAN API Key 和实际图片模型名做真接口验收。

- [x] T034 完成 GPT 限流与可重试判定
  - Acceptance：只重试确定安全的失败，保留供应商错误信息的脱敏摘要。
  - Verify：429、5xx、超时、断流测试。
  - Files：错误分类、重试策略、测试。

## P4：ComfyUI 与 H3

- [ ] T040 实现 ComfyUI Profile 和鉴权
  - Acceptance：支持无鉴权、Bearer、Basic 和白名单请求头。
  - Verify：模拟服务连接测试。
  - Files：Profile Schema、连接客户端、API、测试。

- [ ] T041 实现 HTTP/WebSocket 客户端
  - Acceptance：支持系统状态、队列、提交、历史、取消、上传、查看和进度事件。
  - Verify：模拟 ComfyUI 全流程集成测试。
  - Files：Comfy 客户端、事件解析、测试。

- [ ] T042 实现环境自检
  - Acceptance：报告连接、节点类型、模型文件、工作流版本和输出目录问题。
  - Verify：缺少每一项的 Fixture 测试。
  - Files：环境检查器、结果 Schema、UI、测试。

- [ ] T043 固化 H3 文生视频工作流
  - Acceptance：只替换白名单参数，工作流带版本和哈希。
  - Verify：映射快照测试 + 真机生成。
  - Files：工作流 JSON、映射器、能力表、测试。

- [ ] T044 固化 H3 图生视频工作流
  - Acceptance：上传首帧并生成可下载视频。
  - Verify：映射测试 + 9:16 真机生成。
  - Files：工作流 JSON、映射器、上传服务、测试。

- [ ] T045 验证首尾帧、音频和参数能力
  - Acceptance：逐项得到“支持/不支持/限制”，UI 与能力表一致。
  - Verify：真机验收矩阵。
  - Files：能力表、工作流、参数 UI、验收记录。

- [ ] T046 实现输出发现与可靠下载
  - Acceptance：识别历史输出，流式下载、临时文件落盘、校验后原子改名。
  - Verify：断流、磁盘满、重复下载测试。
  - Files：输出解析、下载器、媒体仓储、测试。

## P5：恢复与可靠批量

- [ ] T050 提交原子性和 `prompt_id` 保存
  - Acceptance：收到 `prompt_id` 后立即持久化，进程崩溃不会触发盲目重复提交。
  - Verify：在各提交阶段注入崩溃测试。
  - Files：提交协调器、Job 仓储、测试。

- [ ] T051 实现 ComfyUI 历史恢复
  - Acceptance：对运行、完成、失败和丢失任务给出正确状态。
  - Verify：`/queue`、`/history` Fixture 矩阵。
  - Files：恢复器、状态映射、测试。

- [ ] T052 实现断线重连
  - Acceptance：WebSocket 断开使用退避重连，期间不重复提交。
  - Verify：网络抖动集成测试。
  - Files：连接监督器、事件服务、测试。

- [ ] T053 实现应用重启恢复
  - Acceptance：排队、已提交、下载中任务均按规则恢复。
  - Verify：E2E 重启测试。
  - Files：启动恢复服务、数据库查询、测试。

- [ ] T054 实现批次操作
  - Acceptance：取消排队、失败项重试、重新下载、查看参数均可用。
  - Verify：任务抽屉 E2E。
  - Files：批次 API、任务抽屉、测试。

- [ ] T055 实现释放实例前检查
  - Acceptance：显示每个算力仍在运行或未下载的数量。
  - Verify：混合任务状态测试。
  - Files：连接摘要 API、算力抽屉、测试。

## P6：桌面与 LAN Web

- [x] T060 建立 Electron 外壳和本机服务生命周期
  - Acceptance：单实例启动、端口自动选择、窗口与服务健康联动。
  - Verify：桌面 E2E 和端口冲突测试。
  - Files：Electron 主进程、IPC 契约、启动器、测试。

- [ ] T061 实现托盘后台行为
  - Acceptance：关窗继续运行；有任务时完全退出二次确认。
  - Verify：真实 Windows 手动测试 + 可自动化部分。
  - Files：托盘、窗口生命周期、退出对话框、测试。
  - Status：托盘、关窗隐藏、完全退出和活动任务确认代码已完成；等待带真实长任务做人工验收。

- [ ] T062 实现 DPAPI/safeStorage
  - Acceptance：敏感配置仅在当前 Windows 用户下可解密。
  - Verify：密文检查、错误用户/损坏密文路径测试。
  - Files：桌面安全适配器、Profile 仓储、测试。

- [ ] T063 实现局域网开关与访问密码
  - Acceptance：默认仅 localhost；开启后 LAN 可访问且必须通过密码。
  - Verify：两台 Windows 电脑 LAN 访问测试。
  - Files：服务监听配置、会话认证、设置 UI、测试。

- [ ] T064 构建 Windows 安装包
  - Acceptance：干净 Windows 安装、启动、升级覆盖和卸载流程通过。
  - Verify：`npm run build:win` + 安装矩阵。
  - Files：构建配置、图标、安装脚本、发布说明。
  - Status：`0.1.0-alpha.1` NSIS 安装包已构建并在当前 Windows 用户下完成安装、覆盖安装和启动验证；仍需干净 Windows 与卸载矩阵后关闭任务。

- [x] T065 按 LibTV 截图实施高保真画布 UI
  - Acceptance：白色无限画布、左上工作区胶囊、右上状态入口、底部悬浮工具条、节点生成输入条、添加菜单和大弹层与参考截图同构；GPT、ComfyUI、项目和任务功能仍可使用。
  - Verify：固定视口视觉对照、核心按钮交互、TypeScript、单元测试、Vite 构建和 Windows 覆盖安装。
  - Files：`src/vela/`、画布节点组件、上下文菜单、视觉 QA 记录、桌面发布产物。

## P7：验收与发布

- [ ] T070 完成自动化测试门禁
  - Acceptance：typecheck、lint、unit、integration、e2e、web build、win build 全通过。
  - Verify：执行规格命令并保存报告。
  - Files：测试配置、报告。

- [ ] T071 完成性能和资源占用测试
  - Acceptance：记录内存、CPU、GPU、FPS、磁盘；未达标项有审批后的处理结论。
  - Verify：固定硬件和固定项目 Fixture 重复 3 次。
  - Files：性能脚本、报告。

- [ ] T072 完成安全验收
  - Acceptance：项目、日志、导出包、前端包和错误弹窗无秘密。
  - Verify：自动扫描 + 人工复核。
  - Files：安全报告、必要修复。

- [ ] T073 编写团队使用和运维手册
  - Acceptance：非开发成员可按手册连接算力、生成、恢复、下载和排错。
  - Verify：由一名未参与开发的团队成员完成首次使用。
  - Files：`docs/USER_GUIDE.md`、`docs/CLOUD_COMFY_GUIDE.md`、`docs/TROUBLESHOOTING.md`

- [ ] T074 团队 Beta 试用
  - Acceptance：完成至少一个真实批量项目，无阻断级数据丢失/重复提交。
  - Verify：试用记录和问题清单全部关闭或接受。
  - Files：`docs/BETA_REPORT.md`

- [ ] T075 发布 1.0.0
  - Acceptance：安装包、哈希、变更日志、已知问题、回滚包齐全。
  - Verify：从发布包重新安装并完成冒烟测试。
  - Files：发布产物、`CHANGELOG.md`、发布说明。

## 后续版本（不进入第一版）

- [ ] Seedance Provider 与文/图/首尾帧视频节点。
- [ ] 更多 GPT/图片供应商适配器。
- [ ] 算力自动选择与跨实例调度。
- [ ] 可选自动更新和代码签名。
