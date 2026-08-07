# Vela LibTV 高保真画布 Design QA

## 视觉真值

用户于 2026-08-06 提供的 9 张 LibTV 截图是本轮唯一视觉真值：

- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-9a6cc57c-161c-4482-8398-89131114d64d.png`：完整画布
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-d14971df-1c42-413c-949f-cbef648a50d0.png`：工具箱
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-19e3205e-39c1-430f-b842-252fefdea44e.png`：素材库入口
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-4e2bb3c1-ec8e-430a-916c-2e8dc9775df6.png`：角色库
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-a4ec990b-9043-4fce-8363-3b459c6c8a1a.png`：历史资产
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-5230ad0b-720a-4d59-a119-a5e5f450f9ad.png`：快捷键
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-8ed757ae-4b48-4956-8f9f-d6c026c3e98e.png`：文本节点
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-64a10f41-8104-4731-990f-4735dc3781bf.png`：图片节点
- `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-c1106d85-11cf-4220-8d69-287790c71a4e.png`：添加节点菜单

Vela 保留自己的名称、算力管理、任务恢复、GPT 与 ComfyUI 能力；不复制 LibTV 商标、会员、点数和 Agent 业务。

## 实现证据

- 完整画布：`output/libtv-multinode-pass2b.png`
- 文本节点：`output/libtv-prompt-1024x858-final2.png`
- 图片节点：`output/libtv-image-1152x797-final3.png`
- 添加节点：`output/libtv-add-menu.png`
- 快捷键：`output/libtv-shortcuts-pass1.png`
- 资产管理：`output/libtv-assets-pass1.png`
- 同屏对比：`output/qa-full-comparison.png`
- 同屏对比：`output/qa-prompt-comparison.png`
- 同屏对比：`output/qa-image-comparison.png`

浏览器 DPR 为 1。聚焦文本节点使用 1024×858 实现视口，对应源图实际像素 1022×857；聚焦图片节点使用 1152×797 实现视口，对应源图实际像素 1135×795；完整画布使用 2016×1117 实现视口，对应源图实际像素 2012×1119。对比图仅把实现截图以 Lanczos 缩放到源图实际尺寸，分别为 2×1、17×2 和 4×2 像素的轻微归一化，未裁剪内容。

## 比对结果

- 画布：白色点阵无限画布、左上工作区胶囊、右上操作区、底部居中工具条、左下资产与缩放均与源布局同构。
- 文本节点：370×370 卡片、左右连接点、节点标题、建议动作和 660×144 输入区的层级、间距、描边、圆角与源图匹配。
- 图片/视频节点：656×370 卡片和 660×190 输入区匹配源图；模型、账户、比例、清晰度、数量被放在节点内，符合 Vela 的真实业务参数。
- 弹层：添加菜单、快捷键、素材/历史资产均采用白色浮层、克制阴影和中文信息层级；关闭、切换、创建节点等主交互可用。
- 多节点：新增节点会水平避让，不遮挡已有输入区；画布连接和运行状态仍可使用。
- 可访问性：所有图标按钮均有 `title` 或文字说明，键盘帮助可随时打开。
- 浏览器控制台错误：0。

## 修复记录

第一轮发现的可见问题包括：收起后的任务栏仍占据画布右侧、旧 Inspector 破坏源图留白、添加菜单在小视口下被裁切、媒体节点偏小、资产面板仍是旧英文侧栏。第二轮已完成：关闭状态完全隐藏任务中心、账户选择移动进节点输入区、添加菜单向上避让、文本与媒体节点按源图尺寸冻结、资产管理改为中文大弹层，并加入节点碰撞避让。复检未发现阻塞发布的 P0、P1 或 P2 视觉问题。

## 剩余非阻塞差异

- P3：Vela 使用自身品牌标志和 Lucide 图标，不复制 LibTV 图标资产。
- P3：参考图里的帽子、人物等是用户项目内容；实现用真实节点空状态展示，生成或导入后由实际项目素材替换。
- P3：Vela 右上角保留算力、任务和保存入口，以满足云端 ComfyUI 连接与本地任务恢复需求。

final result: passed
