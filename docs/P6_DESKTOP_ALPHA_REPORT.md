# Vela Windows 桌面 Alpha 报告

日期：2026-08-06
版本：`0.1.0-alpha.1`

## 交付结果

Vela 已从开发环境网页启动方式改造成真正的 Windows Electron 桌面应用，并安装到当前电脑。

- 桌面快捷方式：`D:\桌面\Vela AI视频画布.lnk`
- 安装位置：`%LOCALAPPDATA%\Programs\vela-ai-canvas\Vela AI视频画布.exe`
- 安装程序：`release\Vela-Setup-0.1.0-alpha.1-x64.exe`
- 项目目录：`%USERPROFILE%\Documents\Vela Projects`
- 应用数据：`%APPDATA%\Vela AI视频画布\data`
- 素材与旧版库：`%APPDATA%\Vela AI视频画布\library`
- 桌面后端日志：`%APPDATA%\Vela AI视频画布\logs\desktop-service.log`

## 已实现能力

- Electron 单窗口与单实例锁；重复双击只唤醒原窗口。
- 启动时自动选择可用的本机端口，避免固定 `3001` 端口冲突。
- Electron 内置启动 Express 控制服务，健康后才加载画布。
- 前端、后端和 Node/Electron 运行环境一起打包，不依赖浏览器、命令行或本机 npm。
- 关闭窗口缩到系统托盘；托盘可重新打开或完全退出。
- 有活动任务时完全退出会二次确认。
- 安装程序创建桌面和开始菜单快捷方式，卸载默认保留项目与应用数据。
- 安装包内部只读；聊天、素材、数据库、日志和项目全部重定向到 Windows 用户目录。
- 主窗口禁用 Node 集成，启用上下文隔离与 sandbox，外部链接交给系统浏览器。

## 验证

- TypeScript：通过。
- Node/集成测试：43 项通过。
- Vite 生产构建：通过。
- Electron 开发窗口：启动通过。
- `win-unpacked` 打包窗口：启动通过。
- NSIS 静默安装与覆盖安装：退出码 0。
- 已安装桌面快捷方式启动：通过。
- 已安装窗口：`Vela AI 生成画布`，Windows 响应正常。
- 快捷方式实际窗口截图：`output/desktop-shortcut-fixed.jpg`。
- 内置服务：随机端口启动，`/api/vela/health` 返回 `ok: true`。
- 安装包大小：约 139.7 MB。
- 安装程序 SHA-256：`0B4ADE7E3A7B0029C164E093BE0CFB1F3DBA3766A94F2E222398F17D31CEF747`。
- GPT 图片生成请求使用至少 5 分钟的等待窗口；模型列表和普通连接测试仍保留较短超时，避免连接异常时长时间卡住。
- 中文项目路径会触发 Electron 解压目录的 Windows 重命名异常；`scripts/build-win.mjs` 已固定通过系统英文临时目录构建，再把完整 NSIS 产物复制回 `release`。

## 已知限制

- 当前 Alpha 没有购买 Windows 代码签名证书，复制到其他电脑安装时可能出现 SmartScreen 提示。
- DPAPI / Electron `safeStorage` 迁移尚未完成；当前 GPT Profile 仍使用 P3 的 AES-256-GCM 本机主密钥方案。
- 局域网访问开关和访问密码尚未实现，桌面后端固定只监听 `127.0.0.1`。
- 需要带一个真实长任务验证“关窗托盘继续运行”和“完全退出二次确认”的完整人工路径。
- Web 生产包仍有约 556 KB gzip 的旧代码分包警告，不阻塞桌面运行。
