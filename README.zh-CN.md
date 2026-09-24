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

目前尚未发布公开版本，可以按照下方说明从源码运行或构建本地应用。

当前打包目标为 **macOS DMG**，本地构建已在 **Apple Silicon（arm64）** 上验证。暂未提供 Windows、Linux 或 Intel Mac 安装包。正式版本发布后，下载对应架构的 DMG，打开后将 Hamster Studio 拖入“应用程序”即可安装。

未配置 Apple Developer 证书的本地构建为未签名版本。正式发布包的签名和公证取决于仓库配置的 Apple 凭证，请以各版本发布说明为准。详细打包步骤见 [BUILD.md](BUILD.md)。

## 快速开始

1. 打开 **设置 → Providers → 添加**。
2. 填写名称、服务的 **Base URL** 和 **API Key**。常见 Base URL 格式为 `https://api.example.com/v1`。
3. 点击 **从 Provider 拉取模型**。只有主动点击才会获取；也可以手动添加模型 ID、删除列表中的模型，然后保存 Provider。
4. 新建会话，在输入区域选择 Provider 和模型。图标表示聊天或图片生成能力。
5. 输入消息或图片描述。图片生成后，点击下方的 **导出图片** 保存副本。

使用 **Enter** 发送、**Shift + Enter** 换行。在 **设置 → 通用 → 语言** 中切换界面语言，选择会保存在本机。

Provider 需要支持应用使用的 OpenAI Compatible 接口：`/models`、流式 `/chat/completions`，以及用于图片生成的 `/images/generations`。模型是否可用及调用费用由服务商决定。生成图片时，请选择服务商支持的图片模型，例如其提供的 `gpt-image-2`。

## 数据与隐私

- 会话和 Provider 配置存放于 Electron 应用数据目录的 `studio.db`，生成图片存放于其中的 `images/` 子目录。
- AI 请求由桌面应用直接发送到配置的 Provider，无需 Hamster Studio 账号或托管应用后端。
- 系统加密可用时，API Key 使用 Electron `safeStorage` 加密；当前实现在加密不可用时会退回未加密字节存储，请勿分享本地数据库。
- 更新检查会连接 GitHub；项目和作者链接通过系统浏览器打开。

删除 Provider 不会删除已有会话。选择新的 Provider 和模型后即可继续使用。

## 本地开发

使用与 CI 一致的 **Node.js 24** 和 npm。项目采用 Electron、React、TypeScript 与 Vite。

```bash
git clone https://github.com/xrdavies/hamster-studio.git
cd hamster-studio
npm ci
npm run dev
```

| 命令                     | 用途                                   |
| ------------------------ | -------------------------------------- |
| `npm run dev`            | 启动桌面开发环境                       |
| `npm run format`         | 使用 Prettier 格式化代码和文档         |
| `npm run format:check`   | 检查代码格式                           |
| `npm run typecheck`      | 检查 TypeScript 类型                   |
| `npm test`               | 运行测试                               |
| `npm run build:renderer` | 构建渲染进程、主进程及 preload         |
| `npm run build:dir`      | 构建未封装为 DMG 的 macOS 应用         |
| `npm run build`          | 执行类型检查和测试，然后构建 macOS DMG |

应用产物位于 `release/`。签名、发布与图标生成详见 [BUILD.md](BUILD.md)。翻译文案位于 `src/shared/locales/`，模型能力规则及更新方法见 [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)。

维护者发布新版本时，请按 [发布流程](RELEASE.md) 完成版本准备、打标签、签名验证与正式发布。

## 参与贡献

欢迎通过 [GitHub Issues](https://github.com/xrdavies/hamster-studio/issues) 提交 Bug 和功能建议。报告问题时请提供应用版本、操作系统、复现步骤及预期行为；分享日志前请移除 API Key 和私人内容。

提交 PR 时请保持改动集中，提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，并运行格式检查、类型检查、测试和渲染进程构建。

## 作者与致谢

作者：**Frozen** · [X / @xrdavies](https://x.com/xrdavies)。

感谢 Electron、React、Vite、Lucide、better-sqlite3、react-markdown 及项目使用的其他开源组件。界面与交互也参考了 hamster-art 和 Cherry Studio。各依赖遵循其各自的许可证。

## 许可证

[MIT](LICENSE) · Copyright © 2026 Frozen。
