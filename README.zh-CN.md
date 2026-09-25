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

- 会话和 Provider 配置存放于 Tauri 应用数据目录的 `studio.db`，生成图片存放于其中的 `images/` 子目录。
- AI 请求由桌面应用直接发送到配置的 Provider，无需 Hamster Studio 账号或托管应用后端。
- API Key: macOS Keychain; no plaintext fallback.
- 更新检查会连接 GitHub；项目和作者链接通过系统浏览器打开。

删除 Provider 不会删除已有会话。选择新的 Provider 和模型后即可继续使用。

## 本地开发

使用与 CI 一致的 **Node.js 24** 和 npm。项目采用 Tauri、React、TypeScript 与 Vite。

```bash
git clone https://github.com/xrdavies/hamster-studio.git
cd hamster-studio
npm ci
npm run dev
```

| 命令                     | 用途                                       |
| ------------------------ | ------------------------------------------ |
| `npm run dev`            | 启动桌面开发环境                           |
| `npm run format`         | 使用 Prettier 格式化代码和文档             |
| `npm run format:check`   | 检查代码格式                               |
| `npm run typecheck`      | 检查 TypeScript 类型                       |
| `npm test`               | 运行测试                                   |
| `npm run build:renderer` | Build React frontend                       |
| `npm run build:dir`      | Compile native executable without bundling |
| `npm run build`          | Build Tauri application and DMG            |

应用产物位于 `src-tauri/target/release/bundle/`。签名、发布与图标生成详见 [BUILD.md](BUILD.md)。翻译文案位于 `src/shared/locales/`，模型能力规则及更新方法见 [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)。

维护者发布新版本时，请按 [发布流程](RELEASE.md) 完成版本准备、打标签、签名验证与正式发布。

## 参与贡献

欢迎通过 [GitHub Issues](https://github.com/xrdavies/hamster-studio/issues) 提交 Bug 和功能建议。报告问题时请提供应用版本、操作系统、复现步骤及预期行为；分享日志前请移除 API Key 和私人内容。

提交 PR 时请保持改动集中，提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，并运行格式检查、类型检查、测试和渲染进程构建。

## 作者与致谢

作者：**Frozen** · [X / @xrdavies](https://x.com/xrdavies)。

感谢 Tauri、React、Vite、Lucide、rusqlite、react-markdown 及项目使用的其他开源组件。各依赖遵循其各自的许可证。

## 许可证

[MIT](LICENSE) · Copyright © 2026 Frozen。

Build prerequisites: Node.js 24, npm, Rust stable, Xcode Command Line Tools.

## 发布

在干净的 `main` 分支执行 `npm run release -- patch`，也可使用 `minor`、`major` 或指定版本。命令更新版本、提交、打标签并推送；GitHub Actions 自动构建和发布。签名配置见 [RELEASE.md](RELEASE.md)。

### 图片 Agent 工作流

对话模型可以查询当前会话图片（`list_images`）、查看图片（`view_image`），以及生成或指定原图编辑（`create_images` 的 `source_image_id` 参数）。例如：“把第二张图的背景改成蓝色，再检查一下结果。”每次编辑都会保留原图并生成新版本。

查看图片需要对话模型同时支持工具调用和视觉输入。用户选中的参考图、Agent 请求查看的图片，会作为多模态用户消息发送给对话模型的 Provider。图片保存在本地，历史记录仅保存引用，不保存 Base64；旧图可通过 `view_image` 再次加载。生成成功不代表 Agent 已经看过图片。

每次任务最多生成 3 张、执行 6 轮模型调用、查看 6 张图片（每张不超过 20 MB）。多张或追加生成需要确认。不支持视觉输入的模型可能返回错误，此时需切换兼容模型后重试。

可从输入框导入本地 PNG、JPEG、WebP 图片（不超过 10 MB）。应用保存当前会话专属的本地副本，可用于看图、Agent 编辑或直接调用图片模型编辑。移除附件只清除输入框的选择。

界面翻译使用 `src/shared/locales/` 中的类型化语义键名，动态内容使用 `{name}` 占位符。界面文案通过 `t(key, parameters)` 获取，应用错误代码或外部消息通过 `translateMessage` 展示，不反向翻译用户内容或 Provider 错误。

### Agent 中断与重试

图片步骤在发送前持久化请求标识和发送状态，每张完成后保存结果。同一任务重复调用已完成的相同步骤会复用结果；当前会话存在相同请求或结果未知的步骤时，后续图片请求需确认。重启不会自动重放付费工具，已生成的图片仍保留。该保护不能替代 Provider 侧幂等：取消、断网或超时后服务端可能继续处理，请检查服务商记录后再生成。

连接超时 30 秒，对话模型单次 HTTP 请求上限 10 分钟，单张图片完整请求上限 10 分钟，等待用户确认上限 15 分钟，整个任务上限 30 分钟。图片超时、模型错误和用户取消分别展示；错误详情可展开。部分图片成功时保留结果，不自动重试剩余请求。

在聊天中提供公开 HTTP(S) 链接并要求读取或总结即可，无需搜索 API Key。仅允许读取当前会话用户提供的链接。支持 HTML 和纯文本，超时 30 秒，响应最多 2 MB，正文截取最多 16000 字符。不支持 JavaScript、登录和 PDF，不访问内网，也不走系统代理；提取内容会发送给对话模型服务商。

当域名仅解析到代理 Fake-IP 网段（198.18.0.0/15）时，网页读取器通过 Cloudflare 加密 DNS 查询真实公网 IPv4 地址，校验后固定连接地址。仅域名发送给解析服务；内网和直接输入的保留 IP 仍被拦截。
