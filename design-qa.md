# V-MNH 主页设计验收

## 对照信息

- 源图（默认状态）：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-6529bb49-b283-4db0-b8a1-37f6e14beaa5.png`
- 源图（项目菜单）：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-5b387780-9285-4d24-8621-a973df3e43b4.png`
- 实现全景：`D:\codex项目\minimaxAi视频前端\vela\output\vela-home-1440x900.png`
- 实现左栏（默认状态）：`D:\codex项目\minimaxAi视频前端\vela\output\vela-home-sidebar-closed-crop.png`
- 实现左栏（项目菜单）：`D:\codex项目\minimaxAi视频前端\vela\output\vela-home-sidebar-menu-crop.png`
- 实现窄屏：`D:\codex项目\minimaxAi视频前端\vela\output\vela-home-320x760.png`
- 浏览器验收视口：1440 x 900 CSS px，`deviceScaleFactor = 1`
- 响应式检查：320 x 760、768 x 820、1024 x 820、1440 x 900 CSS px
- 像素尺寸：源图 239 x 703 与 252 x 738；实现全景 1440 x 900；左栏裁剪 248 x 671
- 密度处理：均按 1x 像素查看；源图只包含侧栏，因此左栏使用同高度裁剪进行重点对照。
- 状态：有 15 个本地项目的默认首页，以及第一个项目的三点菜单展开状态。

## Findings

- 没有可操作的 P0、P1 或 P2 问题。
- [P3] 左侧导航与参考图的功能数量不同。
  - Location: `VelaHome` 左栏导航。
  - Evidence: 参考图还包含 `Skills` 和“创作者挑战赛”；当前产品只提供“首页”与“项目”。
  - Decision: 这是按用户“主页只需新建项目和最近项目”所做的功能精简，不属于视觉缺失。
- [P3] 项目缩略图内容与参考图不同。
  - Location: 最近项目列表和主区卡片。
  - Evidence: 实现显示用户现有项目的真实封面或默认图标，而不是复制参考图素材。
  - Decision: 真实项目数据优先，缩略图尺寸、裁剪和圆角与参考保持一致。

## Required Fidelity Surfaces

- Fonts and typography: 使用 `Microsoft YaHei UI` / `PingFang SC` / `Noto Sans SC` 回退链；导航、项目名、次要时间和页面标题层级清晰，项目名有单行截断。
- Spacing and layout rhythm: 248 px 左栏与参考图约 239–252 px 比例一致；新建按钮、导航行、最近项目行和弹出菜单的节奏相符。
- Colors and visual tokens: 使用白色侧栏、浅灰选中态、青色主按钮、黑色主文字；对比度和焦点边框满足可读性。
- Image quality and asset fidelity: 品牌使用已有 `build/icon.png`；项目封面使用真实资产并保持 `object-fit: cover`；缺图时使用 Lucide 图片图标，未使用 CSS 伪造资产。
- Copy and content: 包含“新建项目”、“最近项目”、节点数、更新时间、打开、重命名、删除项目和不可撤销说明，与实际功能一致。

## Full-view Comparison Evidence

- 全景截图确认桌面端左栏保持固定，右侧最近项目卡片在 1440 px 宽度下为四列，未覆盖持久操作。
- 320、768、1024 和 1440 px 宽度下 `scrollWidth === innerWidth`，没有水平溢出。

## Focused-region Comparison Evidence

- 已将参考图与实现的 248 x 671 左栏裁剪放在同一比较输入中查看。
- 重点对照品牌行、新建按钮、选中导航、最近项目行、三点按钮与“打开/重命名/删除项目”菜单，无 P0–P2 差异。

## Interaction Verification

- 软件启动默认进入首页。
- “新建项目”创建持久化的“未命名项目”，并进入 0 节点空画布。
- 画布品牌按钮可返回首页，项目计数由 15 增加到 16。
- 测试项目成功重命名为“主页功能测试”，随后通过确认对话框删除，计数恢复为 15。
- 页面无运行时 console error；仅保留项目原有 Tailwind CDN 开发警告。
- 键盘友好：按钮、菜单、命名输入和确认对话框均使用语义元素与明确标签；首页状态下画布全局快捷键已停用。

## Comparison History

1. 首轮交互验收发现同一项目的侧栏菜单和主区菜单会同时渲染（P2）。
2. 已将菜单状态从单纯项目 ID 改为 `sidebar:<id>` / `tile:<id>`，两个入口现在独立展开。
3. 修复后重新捕获菜单状态，DOM 中只存在一个菜单，重命名与删除实测通过。

## Implementation Checklist

- [x] 启动默认首页
- [x] 新建项目与独立空画布
- [x] 最近项目、封面和更新时间
- [x] 打开、重命名、删除和确认对话框
- [x] 返回首页前保存当前画布
- [x] 桌面端与窄屏响应式验证

## Follow-up Polish

- 如后续增加模板或技能市场，可按参考图在左侧导航追加入口，不影响当前项目流程。

final result: passed

---

# V-MNH v0.5.23 连线悬停剪刀删除验收（2026-08-12）

- 交互计时：鼠标悬停 0.9 秒时剪刀数量为 0；移出并等待后仍为 0，确认不会误触发且计时会取消。
- 持续悬停：在目标曲线上连续悬停 2.2 秒后出现 1 个圆形剪刀按钮，位置位于曲线中部。
- 精确删除：测试项目包含两条输入连线；点击剪刀后连线数量由 2 变为 1，目标节点的 `parentIds` 仅保留另一输入 `qa-parent-b`。
- 自动化回归：TypeScript 检查通过，Node 测试 79/79 通过，Vite 生产构建通过。
- 桌面连续性：0.5.23 已原位更新；安装目录 `app.asar` SHA-256 与新构建一致，桌面快捷方式目标未改变，4 个正式项目均保留。
- 清理：临时 QA 项目已删除，项目总数恢复为 4；未上传 GitHub Release。

final result: passed

---

# V-MNH v0.5.20 多图勾选下载与姿势批处理验收

## 对照信息

- 参考图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-98fbd471-7e3c-4d4a-b32c-bb815c929cd3.png`（1244 × 728）。
- 实现截图：`D:\codex项目\minimaxAi视频前端\vela\qa\v0.5.20-multi-download-selection.png`（1240 × 728 CSS px，DPR 1）。
- 同图对照：`D:\codex项目\minimaxAi视频前端\vela\qa\v0.5.20-reference-comparison.png`（2480 × 728）。
- 验收状态：选中三图结果节点，进入多图下载模式，并勾选第 1、3 张图片。

## 视觉与交互结论

- 点击多图节点的“下载”会自动展开叠放结果，并为每张图片显示独立勾选框。
- 已选图片使用暗化蒙层、深色边框和高对比勾号；未选图片保持清晰，工具栏实时显示 `已选 N/M`。
- “全选 / 取消全选”“下载已选”和关闭选择模式均已通过浏览器交互验收。
- 实际只下载了第 1、3 张图片，两个文件大小均非零，未下载未勾选的第 2 张。
- 多姿势批处理提示词明确要求正面、左侧、右侧、背面/背面三分之四与自然走动/转身，动作自然放松并避免重复和僵硬。
- 固定屏幕工具栏、节点、提示词面板均无裁切、遮挡或低对比度问题。

## Comparison History

1. 参考图只有直接下载入口；实现保留原有工具栏语言，并增加多图选择状态。
2. 对照第 1、3 张选中与第 2 张未选中的状态，选择层级与可读性通过。
3. 控制台无应用错误，仅保留项目既有的 Tailwind CDN 开发警告。

## 自动化、安装与数据验证

- `npx tsc --noEmit`：通过。
- `npm run test:node`：79/79 通过。
- `npm run build` 与 `npm run pack:win`：通过。
- Windows 桌面安装版已原位更新到 `0.5.20`，安装目录 `app.asar` 与本次打包产物哈希一致，原快捷方式保持不变。
- 临时 QA 项目已删除，三个原有本地项目保留。
- “买家秀”与“买家秀（导入）”中的 7 个多姿势节点均已同步为新提示词和 `pose-variation` 批处理模式。

final result: passed

---

# V-MNH v0.5.19 多图结果叠放与展开验收

## 对照信息

- 折叠参考图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-78ca6bb6-da9b-4d8a-b288-01f5b8fcb896.png`（574 x 697 px）。
- 展开参考图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-1e65a3c9-be24-4d01-9cc8-29b1fe2b21cd.png`（560 x 420 px）。
- 折叠实现截图：`D:\codex项目\minimaxAi视频前端\vela\qa-collapsed-full.png`（1280 x 720 px）。
- 展开实现截图：`D:\codex项目\minimaxAi视频前端\vela\qa-expanded-full.png`（1280 x 720 px）。
- 折叠同图比较：`D:\codex项目\minimaxAi视频前端\vela\qa-collapsed-comparison.png`。
- 展开同图比较：`D:\codex项目\minimaxAi视频前端\vela\qa-expanded-comparison.png`。
- 验收视口：1280 x 720 CSS px；浅色画布；79% 画布缩放；三张真实本地生成结果。

## Findings

- 没有可操作的 P0、P1 或 P2 问题。
- [P3] 参考截图和验收截图使用了不同的真实人物与场景素材；本轮只验证多结果容器的叠放、数量角标、原位展开和折叠逻辑，因此不影响结论。

## 对照结论

- 折叠状态使用真实的第二、第三张图片作为后层，不使用占位框或 CSS 伪造素材；右上角显示“3张”数量角标。
- 点击数量角标后，同一节点在原位置展开为三张独立图片，保持统一高度、连续间距、圆角与阴影；每张图片仍可单独点击查看大图。
- 展开后节点宽度与右侧连接端口同步移动，收起后恢复原始宽度和叠放层次。
- 折叠、展开、再次收起均已实测；浏览器 console error 为 0。

## Comparison History

1. 首轮检查发现桌面安装目录中的 `app.asar` 仍是旧构建，虽版本号已更新但新组件未加载。
2. 关闭仅属于 `D:\桌面\vela-ai-canvas` 的进程后，重新覆盖 0.5.19 便携构建，并校验源/目标 `app.asar` SHA-256 完全一致。
3. 重新打开原桌面快捷方式，创建不触发计费的三图视觉检查项目，完成折叠、展开、收起和同图对照复检。

## 自动化与安装验证

- `npm.cmd run test:node`：79/79 通过。
- `npm.cmd run build`：通过。
- Windows 便携构建：`release\win-unpacked-0.5.19b\win-unpacked`。
- 原安装目录：`D:\桌面\vela-ai-canvas`；产品版本 `0.5.19.0`。
- 原快捷方式、用户项目、素材、API 账户配置未更改；未生成或上传工作流分享包。

final result: passed

---

# V-MNH v0.5.13 画布连接线视觉验收

## 对照信息

- 参考截图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-5090b952-32a4-4315-8105-47581245799a.png`（986 × 619）。
- 实现截图：`D:\codex项目\minimaxAi视频前端\vela\qa-v0513-connections.png`（1280 × 720）。
- 同图对照：`D:\codex项目\minimaxAi视频前端\vela\design-qa-v0513-comparison.png`。
- 验收状态：浅色画布、60% 缩放、两个素材节点连接到同一个结果节点。

## Findings

- 没有可操作的 P0、P1 或 P2 视觉问题。
- [P3] 参考截图与实现截图使用的节点位置和素材数量不同；本轮只验收用户标注的连接线清晰度，因此不影响结论。

## Required Fidelity Surfaces

- Fonts and typography：未改动现有字体、标题或工具栏排版。
- Spacing and layout rhythm：连接曲线、端口位置与节点布局逻辑保持不变。
- Colors and visual tokens：浅色画布普通连接线使用深灰色 `#5f6368`，选中态使用 `#2f3338`；深色画布同步使用更亮的灰色保证对比度。
- Image quality and asset fidelity：验收画布使用真实项目素材，不引入占位资产。
- Copy and content：未新增或修改用户可见文案。

## Full-view Comparison Evidence

- 参考截图和实现截图已放入同一张对照图检查；实现中的连接线比参考截图明显更深、更粗，在大面积浅色画布上可快速识别。
- 60% 缩放下普通连接线仍保持 2.4 px 的屏幕描边，没有随画布缩放变细。

## Focused-region Comparison Evidence

- DOM 实测普通连接线属性为 `stroke="#5f6368"`、`stroke-width="2.4"`、`vector-effect="non-scaling-stroke"`。
- 透明点击热区保持 20 px，并同样使用恒定屏幕描边，视觉增强没有降低连线点击体验。

## Interaction Verification

- 两条连接线均按父节点到子节点的原有贝塞尔曲线渲染。
- 选中态提升到 3 px；拖拽中的临时连接线提升到 2.6 px，并保留圆角端点。
- 用于视觉验收的临时项目已删除，用户原项目列表和项目数据未被替换。

## 自动化与安装验证

- `npm run test:node`：78/78 通过。
- `npm run build`：通过；仅保留既有的大包体积提示。
- `npm run build:win`：通过，生成 `release/Vela-Setup-0.5.13-x64.exe`。
- Windows 原位覆盖安装：通过；文件版本 `0.5.13`、产品版本 `0.5.13.0`。
- 原桌面快捷方式目标保持不变；数据库安装前后 SHA-256 一致。
- 安装版启动截图：`D:\codex项目\minimaxAi视频前端\vela\qa-v0513-installed.png`。

final result: passed

---

# V-MNH v0.5.7 Boundless 视频节点验收

## 交互与视觉验证

- Boundless 预设会自动填写 `https://boundles.cc/v1`、`seedance2.5`、`/videos`、`/videos/{id}` 与 1800 秒超时。
- 画布“API 视频”节点可独立创建，可切换文生视频/图生视频、16:9/9:16/1:1、720p、4–180 秒和 1–4 条。
- 图生视频没有参考图时显示明确提示并禁用生成按钮。
- 实现截图：`D:\codex项目\minimaxAi视频前端\vela\output\playwright\qa-v057-boundless-video-node.png`。

## 自动化与发布验证

- `npm run test:node`：72/72 通过。
- `node --test src/vela/nodeCatalog.test.ts`：4/4 通过。
- `npm run build`：通过。
- `npm run build:win`：通过，生成 `Vela-Setup-0.5.7-x64.exe`。
- Windows 原位覆盖安装：通过；产品版本 `0.5.7.0`，原安装路径、原桌面快捷方式和用户数据目录保持不变。
- 未发起付费视频任务；Boundless 新标签显示登录页，实机 Key 连接验证留待用户登录后粘贴。

final result: passed with credential verification pending

---

# V-MNH v0.5.8 Boundless 实账户连接校正验收

## 实账户验证

- 已保存 SD2.5 账户的密钥状态为 `ready`，`/models` 连接测试通过。
- 中转站实际返回 `seedance-2.5-480p` 和 `seedance-2.5-720p`，720p 节点使用后者。
- 账户提交路径已校正为 `/videos`，查询路径为 `/videos/{id}`，超时为 1800 秒。
- 这次只执行不计费的模型连接测试，未提交付费视频任务。

## 回归与安装

- `npm run test:node`：72/72 通过。
- `node --test src/vela/nodeCatalog.test.ts`：4/4 通过。
- `npm run build` 和 `npm run build:win`：通过。
- 安装包：`Vela-Setup-0.5.8-x64.exe`，SHA-256 `04F8AFB5BD91D60467A9DD77165DF1F38388B928834CC7CABCC72EAABE1E570B`。
- Windows 原位覆盖安装后产品版本为 `0.5.8.0`，原桌面快捷方式目标不变。
- 用户数据文件数由 286 变为 287（正常运行记录），加密密钥和已保存账户在升级后仍可读取并连接成功。

final result: passed

---

# V-MNH v0.5.6 框选、素材盘与素材操作设计验收

## 对照信息

- 首页精简参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-a791d141-980c-4570-9ebb-766cb67c1f82.png`（1542 x 1018）。
- 多选参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-4dfa6172-537f-4b98-9ad9-910cd1fe2c81.png`（1484 x 895）。
- 素材操作栏参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-024b8d6e-78a6-48fa-9285-c65f33ef7d85.png`（1081 x 615）。
- 安装版主页：`D:\codex项目\minimaxAi视频前端\vela\qa-v056-current-window.png`（2576 x 1408）。
- 安装版素材盘：`D:\codex项目\minimaxAi视频前端\vela\qa-v056-asset-tray-window.png`。
- 安装版素材操作栏：`D:\codex项目\minimaxAi视频前端\vela\qa-v056-media-toolbar-window.png`。
- 安装版框选：`D:\codex项目\minimaxAi视频前端\vela\qa-v056-multiselect-window.png`。
- 安装版批量拖线菜单：`D:\codex项目\minimaxAi视频前端\vela\qa-v056-batch-drop-menu-window.png`。
- 同图对照：`D:\codex项目\minimaxAi视频前端\vela\design-qa-v056-comparison.png`。
- 验收对象：同一桌面快捷方式打开的 Windows Electron 安装版；窗口截图由 Win32 `PrintWindow` 直接捕获，不受其他桌面窗口遮挡。

## Findings

- 没有可操作的 P0、P1 或 P2 视觉问题。
- [P3] 用户参考图与安装版使用了不同的真实本地素材和缩放位置；交互区域、控件层级和选中反馈保持同构。
- [P3] 素材操作栏第一项显示“图片素材”作为类型提示，其后“裁剪”“下载”为操作；这是对参考图大量高级功能的第一版收敛，符合本次范围。

## 交互与状态验证

- 主页品牌区图标、“项目”导航行和主区重复“新建项目”按钮均已移除；左侧主按钮保留。
- 画布顶部“算力”已替换为“素材盘”，安装版从当前项目历史成功任务识别到 8 个图片素材；图片/视频筛选与回插可用。
- 从素材盘回插图片后，新节点自动选中并显示固定屏幕尺寸操作栏；图片可进入既有裁剪器，图片和视频均可下载。
- 鼠标框选两个素材节点后显示组选框与“打组”按钮；每个选中素材底部出现暗色反馈条。
- 拖动任何已选节点会沿用现有多选集合并整组移动；不再把选择收缩为单节点。
- 从多选右侧端口拖到空白处并放开，弹出与双击同源的兼容节点菜单；创建后按稳定顺序把全部兼容来源写入 `parentIds` 并去重。
- 画布底部和顶部均不再显示“算力”入口；任务、工作流、保存和现有连接不受影响。

## 同图比较结论

- 主页对照确认三个红圈冗余入口全部消失，视觉密度更接近用户要求的精简主页。
- 多选对照确认组选框、顶部打组入口和节点底部暗色反馈均可见。
- 素材操作对照确认操作栏位于选中素材上方，不随画布缩放变小，并提供裁剪与下载。
- 参考图与实现截图已放入同一张比较图逐项检查；未发现遮挡、裁切、错误边距或低对比度文字。

## 自动化与安装验证

- `npm run test:node`：66/66 通过。
- `npm run build`：通过；仅保留既有大包体积提示。
- `npm run build:win`：通过，生成 `Vela-Setup-0.5.6-x64.exe`。
- Windows 原位覆盖安装：通过；安装程序版本 `0.5.6`，产品版本 `0.5.6.0`。
- 原桌面快捷方式目标保持为 `C:\Users\Administrator\AppData\Local\Programs\vela-ai-canvas\Vela AI视频画布.exe`，原用户数据库路径保持不变，安装前后校验值一致。

final result: passed

---

# V-MNH v0.5.5 画布效率增强设计验收

## 对照信息

- 参考图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-4fb4290b-d8ed-4381-a148-2aaaa28edc46.png`
- 实现截图：`D:\codex项目\minimaxAi视频前端\vela\design-qa-v055-implementation.png`
- 同图对照：`D:\codex项目\minimaxAi视频前端\vela\design-qa-v055-comparison.png`
- 验收环境：V-MNH Web 本地预览与 Windows Electron 桌面端。

## 验收结果

- [x] 连接到生成节点的两张素材按 `parentIds` 顺序显示编号 1、2 的真实缩略图。
- [x] 生成输入面板在 100% 与 29% 缩放下实测宽度均为约 660 px、高度约 244 px，误差小于 1 px。
- [x] 空白画布拖拽可显示框选区域；多选后右侧显示批量连接端口，一次提交全部兼容节点并去重。
- [x] 顶部“工作流”入口位置与参考图指定区域一致，可保存、使用和删除本地模板。
- [x] 将 6 节点模板插入新画布后节点和连线恢复，历史结果数量为 0，运行字段已清理。
- [x] Node 测试 66/66 通过，Vite 生产构建通过。

## 可接受差异

- 参考图中的输入面板宽度约 660 px；实现沿用 V-MNH 现有圆角、字体和控件样式，只补充缩略图条与固定屏幕尺寸行为。
- 工作流面板使用产品现有右侧浮层语言，避免新增复杂页面。

final result: passed

---

# V-MNH v0.5 设置、API 与主题设计验收

## 对照信息

- 主页入口参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-5b9c7583-a1db-4c42-9045-e9c55eb6e82d.png`
- 深色画布参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-d7900820-d91b-4e1e-97a9-ad6a55e48c72.png`
- API 表单参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-594d2e50-2eff-4a84-af2a-dce69d6332b4.png`
- 实现主页：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\v05-home-final.png`
- 实现浅色设置：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\v05-settings-light.png`
- 实现深色设置：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\v05-settings-dark.png`
- 实现 API 全字段：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\v05-api-endpoints.png`
- 实现深色画布：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\v05-canvas-dark.png`
- 同屏对照：`D:\codex项目\minimaxAi视频前端\vela\.playwright-cli\qa-comparison-v05.png`
- 验收视口：1479 x 955 CSS px。

## Findings

- 没有可操作的 P0、P1 或 P2 视觉问题。
- [P3] 深色画布截图中的项目内容与参考素材不同；这是使用真实本地项目数据造成的正常差异，画布背景、点阵、悬浮控制条和节点边界样式均保持同构。
- [P3] Web 预览中的更新按钮为禁用状态并显示说明；Windows 安装版通过 Electron 更新桥接启用，这是平台能力差异而非功能缺失。

## 交互与状态验证

- 主页左下角 API、设置入口固定可见，切页不改变本地项目。
- 跟随系统、明亮、深色三种界面模式可切换；深色设置页文本、边框和输入框无低对比度问题。
- 白色、黑色画布可独立选择；黑色画布的点阵、节点、工具条和侧栏均正常呈现。
- API 新建表单包含预设、账户名称、供应商、Base URL、提示词/图片/视频模型、Key、并发、超时和五种可选接口路径。
- 新开的干净浏览器标签无 console error；开发期间出现过一次由热更新保留旧表单状态造成的错误，刷新后未复现。
- API Key 不进入公开 Profile；更新令牌只经桌面安全存储传递。

## Comparison History

1. 首轮热更新发现旧表单状态没有 `endpoints`，展开高级路径时触发错误。
2. 对旧状态增加默认端点回退后重新加载，新标签页错误日志为空。
3. 将参考主页、参考深色画布与最终实现放入同一对照图复检，布局、主题与入口位置通过。

## 自动化验证

- `npm run test:node`：54/54 通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过；仅保留既有大包体积警告。
- `npm run build:win`：通过，生成 `Vela-Setup-0.5.0-x64.exe`、`.blockmap` 与 `latest.yml`。
- Windows 覆盖安装：通过；已安装程序版本 `0.5.0.0`，主窗口进程响应正常。

final result: passed
# V-MNH v0.5.22 图片输入节点交互验收（2026-08-12）

- 参考图：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-2dccfc97-024c-4594-ad82-e45f6219121e.png`（606 × 354）。
- 实现截图：`qa/v0.5.22-image-input.png`；对比图：`qa/v0.5.22-comparison.png`。
- 外观：保留原参考图的白色大卡片、居中上传入口、左右连接点；交互说明改为“单击拖动节点 / 双击选择参考图片”。
- 单点拖动：通过，在最终桌面构建中从 `(90, 88)` 拖到 `(183, 122)`，位移 `(93, 34)`。
- 双击选图：通过，真实触发单文件 `filechooser`，`multiple=false`。
- 控制台错误：0。
- 类型检查：通过；Node 测试：79/79 通过；Vite 生产构建：通过。
- 桌面连续性：0.5.22 原位覆盖安装成功，`app.asar` SHA-256 一致，原桌面快捷方式目标未改变，原项目数据仍为 4 个正式项目。
- 最终结果：passed。
