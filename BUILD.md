# 构建

使用 Node.js 24、npm、Rust stable 和 macOS Xcode Command Line Tools。

```bash
npm ci
npm run dev
```

若 Rust 尚未加入 PATH，执行 `source "$HOME/.cargo/env"`。

```bash
npm run format:check
npm run typecheck
npm test
npm run test:rust
npm run build
```

`npm run build` 使用 Tauri 构建应用和 DMG；`npm run build:dir` 只编译应用二进制。产物位于 `src-tauri/target/release/`。本地默认不生成 updater 签名产物，开发模式不检查更新。

## 开发者工具

macOS 开发版和正式版均可通过 **View → Developer Tools** 或 **⌘⌥I** 打开 Web Inspector，默认不自动打开。可查看界面、JavaScript 控制台与前端网络请求；Provider 请求由 Rust 发出，不会显示在前端 Network 面板中。此功能需安装包含该功能的新构建，旧安装包不会自动启用。

React 界面通过 `src/renderer/studio.ts` 调用 Rust commands。Rust 后端负责 HTTP/SSE、SQLite、Keychain、图片文件和模型能力表缓存。数据库及图片位于 Tauri 应用数据目录，macOS 通常为 `~/Library/Application Support/com.hamster.studio/`。API Key 存储在系统凭证库，无法访问时返回错误，不退回明文。

当前迁移不导入旧 Electron 数据。版本从 0.0.1 开始。

图标来自 `build/icon.icns` 和 `build/icon.png`。模型能力维护见 [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)，正式发布见 [RELEASE.md](RELEASE.md)。

## 图片创作 Agent

聊天模型通过 Rig 0.42 的 Chat Completions 接口执行工具调用。直接在对话中描述图片需求；无需开启 Agent 模式。模型必须支持流式工具调用。

- 输入框保留主要模型选择；“图片创作设置”单独选择图片 Provider/模型，按会话保存。聊天和图片可以使用不同 Provider。
- 简单单图请求直接执行；多图、追加生成或首次缺少图片配置时，任务卡要求确认。每次任务最多生成 3 张图片、最多 6 次模型调用，总时限 30 分钟。
- 工具步骤折叠显示，图片完成后立即呈现，可放大、导出、引用修改。“重新生成”把提示词放回输入框，用户发送后执行。
- “基于此图修改”调用 `/v1/images/edits`，需要图片 Provider 支持 multipart 编辑接口；失败不会降级成无参考图生成。当前仅支持引用本会话生成的图片。
- 当前 Agent 不读取图片进行视觉评价，也不支持上传外部图片。它可以整理要求、生成多个方案、按文字指令编辑引用图片，但不能声称已检查画面。
- 每个 Session 独立保存消息、模型配置和工具记录。每个 Session 同时一个任务；不同 Session 可同时执行。已配置的 Provider/模型在任务启动时固定；任务中修改配置影响下一次任务。首次补齐缺失图片配置是例外。
- 停止会取消本地执行，不保证 Provider 撤销已接收的请求或费用。工具失败立即停止，不自动重试。已生成图片保留。
- 重启后未完成任务显示中断，不自动恢复或重放付费调用；用户可以基于已生成图片发起新任务。

执行器位于 `src-tauri/src/agent.rs`，图片传输由 `requests.rs` 复用。Agent 的完整成功执行记录保存于消息的 `agentTranscript`，可见步骤保存在 `steps`。未完成任务保留步骤和已生成图片，后续上下文只使用可恢复的文字/产物信息。

本地测试使用 Rig 模拟模型和本地 HTTP 服务，不消耗 Provider 额度：

```bash
npm run test:rust
npm test
```
