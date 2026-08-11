# Spec: Boundless Seedance 2.5 视频生成（0.5.8 连接校正）

## Objective

在现有 Vela Windows 桌面画布中接入 Boundless OpenAI-compatible 视频中转站，并新增独立的“API 视频”节点。用户可以在同一个节点中选择文生视频或图生视频，查看持久化任务进度与上游失败原因，并将完成的视频保存到当前项目素材中。

验收场景：

- API 页面提供 Boundless 预设：Base URL `https://boundles.cc/v1`、当前账户实测模型 `seedance-2.5-720p`、标准提交路径 `/videos`、查询路径 `/videos/{id}`。
- API Key 仅通过现有本机加密 Profile 保存；源码、日志、项目文件和安装包不得出现明文 Key。
- “API 视频”节点支持文生视频与图生视频，比例为 `16:9`、`9:16`、`1:1`，输出固定 `720p`，时长为 4–180 秒。
- 连接图片后可切换图生视频；没有图片时图生视频必须给出可操作提示。
- 提交成功后先保存远端 task id，再按 5 秒节奏查询；`queued`/`processing` 持续更新百分比，`completed` 下载视频，`failed` 显示上游原因。
- 不影响现有 GPT 图片节点、H3/ComfyUI 视频节点、项目素材和桌面快捷方式。

## Tech Stack

- React 19 + TypeScript + Vite 6：画布节点与 API 设置页。
- Node.js + Express：本地 API、任务调度与媒体持久化。
- Electron 43 + electron-builder：Windows 安装包。
- Node test runner：Provider、Runtime、Profile、媒体与节点目录测试。

## Commands

- Test: `npm run test:node`
- Build: `npm run build`
- Package Windows: `npm run build:win`
- Dev: `npm run dev`

## Project Structure

- `server/providers/openAiCompatibleProvider.js`：Boundless 视频提交、查询、状态与错误规范化。
- `server/vela/runtime.js`：持久化远端任务 ID、进度、下载与任务状态转换。
- `server/vela/mediaStore.js`：远端视频下载及项目媒体索引。
- `server/vela/profileRepository.js`：可配置视频提交/查询路径与加密凭据。
- `src/vela/nodeCatalog.ts`：新增 `gpt-video` 语义节点。
- `src/vela/components/`：API 预设、视频模式、比例、时长、账户与状态交互。
- `src/App.tsx`：节点任务创建、图片引用与任务结果同步。
- 同目录 `*.test.js` / `*.test.ts`：回归和协议测试。

## Code Style

沿用当前工程的 ESM、显式输入校验和结构化 ProviderError：

```js
if (!taskId) {
  throw new ProviderError('视频中转站未返回任务 ID', {
    code: 'BAD_RESPONSE',
    safeToRetry: false
  });
}
```

React 交互使用原生 `button`、`label`、`select` 和 `aria-live`，不引入新状态库或新视觉体系。

## Testing Strategy

- Provider 单元测试：请求字段、task id 兼容、状态轮询、进度归一化、失败原因、超时和幂等头。
- Runtime 集成测试：模型预检、task id 持久化、视频下载、媒体索引与 Key 脱敏。
- Profile 测试：Boundless 路径默认值、旧 Profile 向后兼容、危险路径拒绝。
- Frontend 编译与节点目录测试：新节点可创建、连线类型正确、TypeScript 构建通过。
- 安装验收：0.5.8 原位安装后从原桌面快捷方式启动，旧用户数据仍可读取。

## Boundaries

- Always：提交前验证 prompt、模型、时长、比例与引用数量；保存 task id 后再轮询；错误和日志脱敏；保留现有安装和数据。
- Ask first：引入第三方图片托管、上传用户素材到额外服务、改变数据库结构、发布 GitHub Release。
- Never：把 API Key 写入源码/安装包；在未知提交结果时自动重复创建付费任务；删除旧 Profile、项目或素材；改变 H3 节点现有协议。

## Success Criteria

1. Boundless 预设一次选择即可填入除完整 Key 外的所有字段；已保存账户经 `/models` 实测确认 `seedance-2.5-720p` 可用。
2. `gpt-video` 文生视频发送 `model/prompt/seconds/ratio/resolution`；图生视频额外发送 `image_urls`。
3. 节点和任务中心显示统一百分比及具体错误，不出现空白页或只显示泛化网络错误。
4. 完成结果保存到 `outputs/videos` 并能在画布播放、下载和进入素材盘。
5. `npm run test:node`、`npm run build`、Windows 打包及原位安装验证通过。

## Open Questions

- 截图中的 API Key 已遮罩，无法安全恢复完整值；安装后由用户在 Boundless 预设中粘贴一次完整 Key。
- 官方说明 `image_urls` 是公网 URL。Vela 会支持现有公网 URL，并以内联 data URL 兼容本机项目图片；若上游拒绝内联图片，将原样展示上游错误，且不会擅自上传素材到第三方图床。
