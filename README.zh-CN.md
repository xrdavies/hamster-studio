<p align="center">
  <img src="src/renderer/assets/hamster-logo-256.png" width="128" alt="Hamster Studio Logo" />
</p>

# Hamster Studio

[English](README.md) · 简体中文

Hamster Studio 是一款开源的桌面 AI 聊天与图片生成工具。通过 Base URL 和 API Key 接入自定义 OpenAI Compatible 服务，无需注册 Hamster Studio 账号。你可以在会话中切换 Provider 和模型，将历史记录保存在本机，并导出生成的图片。界面支持中文和英文，提供标题搜索、会话置顶与归档，方便整理对话。

[![macOS 构建](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml)
[![格式检查](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml)
[![MIT 许可证](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[下载与更新日志](https://github.com/xrdavies/hamster-studio/releases) · [快速开始](#快速开始) · [问题反馈](https://github.com/xrdavies/hamster-studio/issues)

## 下载与安装

前往 [GitHub Releases](https://github.com/xrdavies/hamster-studio/releases) 查看可用安装包和版本说明。体验尚未发布的修改，可参照[本地开发](#本地开发)从源码运行。

当前打包目标为 **macOS DMG**，本地构建已在 **Apple Silicon（arm64）** 上验证。暂未提供 Windows、Linux 或 Intel Mac 安装包。下载对应架构的 DMG，打开后将 Hamster Studio 拖入“应用程序”即可安装。

未配置 Apple Developer 证书的本地构建为未签名版本。正式发布包的签名和公证取决于仓库配置的 Apple 凭证，请以各版本发布说明为准。详细打包步骤见 [BUILD.md](BUILD.md)。

## 快速开始

1. 打开 **设置 → 模型服务 → 添加**。
2. 填写名称、服务的 **Base URL** 和 **API Key**。常见 Base URL 格式为 `https://api.example.com/v1`。
3. 点击 **从 Provider 拉取模型**。只有主动点击才会获取；也可以手动添加模型 ID、删除列表中的模型，然后保存 Provider。
4. 新建会话，在输入区域选择 Provider 和模型。图标表示聊天或图片生成能力。
5. 输入消息或图片描述。图片生成后，点击下方的 **导出图片** 保存副本。

使用 **Enter** 发送、**Shift + Enter** 换行。在 **设置 → 通用 → 语言** 中切换界面语言，选择会保存在本机。

## 图片创作与网页读取

- **对话创作**：选择支持工具调用的聊天模型，在输入框的图片设置中指定图片模型。看图还需要聊天模型支持视觉输入。
- **添加参考图**：一次选择或拖入多张 PNG、JPEG、WebP 图片，最多 6 张，每张不超过 10 MB。可要求融合参考图创作，也可要求分别处理素材。
- **局部修改**：点击参考图附件上的画笔，涂抹目标区域，再输入修改要求。图片服务需要支持遮罩编辑，区域外的保留效果取决于模型。
- **预览与导出**：点击生成结果查看大图，导出保存，或作为参考图继续编辑；原图会保留。
- **读取网页**：提供公开网页链接并要求总结。支持 HTML 和纯文本，暂不支持登录页、JavaScript 渲染和 PDF。

回复中断后可按提示继续；图片结果未知时，再次付费生成需要确认。

### Provider 兼容性

Provider 需要支持对应功能使用的接口：模型获取使用 `/models`，聊天使用流式 `/chat/completions`，图片生成使用 `/images/generations`，参考图与局部修改使用 `/images/edits`。工具调用、视觉、多参考图和遮罩支持因服务商及模型而异。模型是否可用及调用费用由服务商决定。

## 数据与隐私

- 会话和 Provider 配置存放于 Tauri 应用数据目录的 `studio.db`，生成图片存放于其中的 `images/` 子目录。
- AI 请求由桌面应用直接发送到配置的 Provider，无需 Hamster Studio 账号或托管应用后端。
- API Key 保存在系统凭据库（macOS Keychain），不回退到明文存储。
- 图片输入和网页提取正文会发送给配置的对话模型服务商。网页读取会访问目标网站；代理 Fake-IP 解析可能将域名发送至 Cloudflare 加密 DNS。
- 更新检查会连接 GitHub；项目和作者链接通过系统浏览器打开。

删除 Provider 不会删除已有会话。选择新的 Provider 和模型后即可继续使用。

## 本地开发

使用 **Node.js 24**、npm、Rust stable 和 Xcode Command Line Tools。项目采用 Tauri、React、TypeScript 与 Vite。

```bash
git clone https://github.com/xrdavies/hamster-studio.git
cd hamster-studio
npm ci
npm run dev
```

| 命令                     | 用途                           |
| ------------------------ | ------------------------------ |
| `npm run dev`            | 启动桌面开发环境               |
| `npm run format`         | 使用 Prettier 格式化代码和文档 |
| `npm run format:check`   | 检查代码格式                   |
| `npm run typecheck`      | 检查 TypeScript 类型           |
| `npm test`               | 运行前端测试                   |
| `npm run test:rust`      | 运行后端测试                   |
| `npm run build:renderer` | 构建 React 前端                |
| `npm run build:dir`      | 编译原生程序，不打包           |
| `npm run build`          | 构建 Tauri 应用与 DMG          |

应用产物位于 `src-tauri/target/release/bundle/`。翻译文案位于 `src/shared/locales/`。Agent 系统提示词位于 `src-tauri/prompts/image-agent.txt`，构建时嵌入程序。

### 发布

在干净的 `main` 分支执行：

```bash
npm run release -- patch
```

也可将 `patch` 替换为 `minor`、`major` 或指定版本。命令负责更新版本、提交、打标签并推送；GitHub Actions 随后自动构建、签名和发布，需事先配置签名凭据。

### 相关文档

| 文档                                  | 内容                            |
| ------------------------------------- | ------------------------------- |
| [构建说明](BUILD.md)                  | 本地构建、开发者工具与实现细节  |
| [发布流程](RELEASE.md)                | 发布准备、签名及 updater 更新包 |
| [模型能力配置](MODEL_CAPABILITIES.md) | 模型分类规则与配置表更新        |
| [变更记录](CHANGELOG.md)              | 开发变更，统一使用中文维护      |

## 参与贡献

欢迎通过 [GitHub Issues](https://github.com/xrdavies/hamster-studio/issues) 提交 Bug 和功能建议。报告问题时请提供应用版本、操作系统、复现步骤及预期行为；分享日志前请移除 API Key 和私人内容。

提交 PR 时请保持改动集中，提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，并运行格式检查、类型检查、测试和渲染进程构建。

## 作者与致谢

作者：**Frozen** · [X / @xrdavies](https://x.com/xrdavies)。

感谢 Tauri、React、Vite、Lucide、rusqlite、react-markdown 及项目使用的其他开源组件。各依赖遵循其各自的许可证。

## 许可证

[MIT](LICENSE) · Copyright © 2026 Frozen。
