# 构建和发布

完整的版本准备、打标签、签名配置、Release 草稿检查及失败重试步骤见 [发布流程](RELEASE.md)。

## 本地开发

npm install
npm run dev

## 本地验证

npm run typecheck
npm test
npm run build:renderer

## macOS DMG

npm run build

产物位于 `release/`。未配置可用签名身份的本地构建为未签名应用；实际签名状态以构建日志为准。

## GitHub Actions

`.github/workflows/build-mac.yml` 在手动触发或推送 `v*` 标签时运行 macOS 构建。

- `workflow_dispatch`：只构建并上传 DMG artifact。
- workflow 已接入下方列出的签名与公证 Secrets；实际签名状态取决于凭证是否配置且有效。

## Provider 本地测试

Provider 配置只保存于本机。API Key 不写入代码、`.env`、Git 或 GitHub Actions。

测试连接时可在应用设置中填写：

- Base URL：`https://api.example.com/v1`
- API Key：用户自己的测试 Key
- 聊天模型：`gpt-5.6`
- 图片模型：`gpt-image-2`

测试 Key 只用于本地验证，验证完成后应删除或更换。

正式发布前，在 GitHub 仓库配置以下 Actions Secrets：

- `MAC_CERTIFICATE_BASE64`：Developer ID Application `.p12` 的 Base64
- `MAC_CERTIFICATE_PASSWORD`：证书密码
- `APPLE_ID`：Apple Developer 账号
- `APPLE_APP_SPECIFIC_PASSWORD`：公证专用密码
- `APPLE_TEAM_ID`：Apple Team ID

workflow 将这些变量传给 electron-builder，签名与公证结果需检查构建日志。macOS 构建同时生成 DMG 和 ZIP；完整更新流程与发布验收见 [发布流程](RELEASE.md#6-应用内更新)。应用图标位于 `build/icon.icns`。

## 品牌资源与模型能力

Logo 源图按 256、512、1024 像素存放在 `src/renderer/assets/`，界面引用 256 像素版本。`build/icon.iconset/` 包含 macOS 所需的 16–1024 像素及 Retina 图标，运行 `iconutil -c icns build/icon.iconset -o build/icon.icns` 重建打包图标。开发版 Dock 使用 `build/icon.png`。

模型能力由 `config/model-capabilities.json` 和 Provider 能力提示区分，支持从 GitHub 检查并应用新版表，详见 [模型能力表](MODEL_CAPABILITIES.md)。手动补充模型无需用户选择类型。

## 代码排版

运行 `npm run format` 格式化代码，提交前运行 `npm run format:check`。VS Code 安装推荐的 Prettier 扩展后保存即格式化。格式规则为 100 字符目标行宽、2 空格缩进、单引号、不加分号。CI 检查格式；生成资源和构建产物不参与。

## CI 钥匙串

Actions 显式创建临时钥匙串并导入签名证书，通过 `CSC_KEYCHAIN` 提供给 electron-builder。导入证书使用 `.p12` 密码，设置私钥访问权限使用独立生成的钥匙串密码。不要同时传入 `CSC_LINK`，否则会重新进入打包器的证书导入流程。任务结束后始终清理临时证书和钥匙串。

## 发布模式

本地 `npm run build`、`npm run build:dir` 和手动 Actions 构建均显式使用 `--publish never`。只有推送 `v*` 标签才使用 `--publish always`，发布步骤将 Actions 自动提供的 `GITHUB_TOKEN` 映射为 `GH_TOKEN`，无需另建个人访问令牌。校验与编译后仅执行一次打包。

Tag builds automatically publish the completed Release after verification, packaging and artifact upload. See [RELEASE.md](RELEASE.md).
