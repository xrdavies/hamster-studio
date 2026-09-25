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
