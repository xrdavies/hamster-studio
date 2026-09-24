# 构建和发布

## 本地开发

npm install
npm run dev

## 本地验证

npm run typecheck
npm test
npm run build:renderer

## macOS DMG

npm run build

产物位于 `release/`。本地构建使用未签名应用，macOS 首次打开时需要在系统设置中允许运行。

## GitHub Actions

`.github/workflows/build-mac.yml` 在手动触发或推送 `v*` 标签时运行 macOS 构建。

- `workflow_dispatch`：只构建并上传 DMG artifact。
- 推送 `v0.1.0` 这类标签：构建 DMG，并使用 electron-builder 发布 GitHub Release 和更新元数据。
- 当前 workflow 使用未签名构建，不需要 Secrets。

正式发布前，在 GitHub 仓库配置 Apple Developer 证书、App Store Connect notarization 凭证，并将签名和公证参数加入 workflow。自动更新只有在 Release 包含 `app-update.yml` 和签名产物时才会启用。

## Provider 本地测试

Provider 配置只保存于本机。API Key 不写入代码、`.env`、Git 或 GitHub Actions。

测试连接时可在应用设置中填写：

- Base URL：`https://buyonce.xyz`
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

workflow 会自动使用这些变量完成签名和公证。自动更新只有在 Release 包含 `app-update.yml` 和签名产物时才会启用。应用图标位于 `build/icon.icns`。

## 品牌资源与模型能力

Logo 源图按 256、512、1024 像素存放在 `src/renderer/assets/`，界面引用 256 像素版本。`build/icon.iconset/` 包含 macOS 所需的 16–1024 像素及 Retina 图标，运行 `iconutil -c icns build/icon.iconset -o build/icon.icns` 重建打包图标。开发版 Dock 使用 `build/icon.png`。

模型名称分类由 `src/shared/model-capabilities.ts` 在构建时配置，Provider 返回的显式图片能力也会被识别。手动补充模型无需用户选择类型。

## 代码排版

运行 `npm run format` 格式化代码，提交前运行 `npm run format:check`。VS Code 安装推荐的 Prettier 扩展后保存即格式化。格式规则为 100 字符目标行宽、2 空格缩进、单引号、不加分号。CI 检查格式；生成资源和构建产物不参与。
