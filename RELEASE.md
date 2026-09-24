# Tauri 发布流程

本地 npm 命令只准备版本、提交和标签；GitHub Actions 自动校验、构建、签名、公证、上传并公开 Release。当前发布 macOS arm64。

## 首次配置

仓库 Actions Secrets：

| 名称                               | 内容                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| MAC_CERTIFICATE_BASE64             | 含私钥的 Developer ID Application p12 的 Base64          |
| MAC_CERTIFICATE_PASSWORD           | p12 导出密码                                             |
| APPLE_SIGNING_IDENTITY             | 完整证书身份，如 Developer ID Application: Name (TEAMID) |
| APPLE_ID                           | Apple Developer 邮箱                                     |
| APPLE_APP_SPECIFIC_PASSWORD        | 公证专用密码                                             |
| APPLE_TEAM_ID                      | Apple Team ID                                            |
| TAURI_SIGNING_PRIVATE_KEY          | Tauri updater 私钥文件的内容                             |
| TAURI_SIGNING_PRIVATE_KEY_PASSWORD | 私钥密码；无密码时可不配置                               |

另外配置 Actions **Variable** `TAURI_UPDATER_PUBLIC_KEY`，内容为对应公钥。Apple 签名与 Tauri 更新签名是不同用途，两者都需要。

```bash
npm run tauri -- signer generate -w "$HOME/.hamster-studio-updater.key"
```

妥善保管私钥，不提交到仓库。将生成的 `.pub` 文件内容填入公钥 Variable，将私钥文件内容填入 Secret。构建时 `scripts/tauri-release-config.mjs` 生成临时配置，嵌入公钥并开启 `createUpdaterArtifacts`。基础配置的公钥为空，因此未注入配置的本地构建不用于正式更新验收。

## 发布命令

在 main 分支且工作区干净时，执行任一命令：

```bash
npm run release -- patch
npm run release -- minor
npm run release -- major
npm run release -- 0.1.0
```

脚本同步 main、检查版本和标签冲突，更新 package.json、package-lock.json、Cargo.toml、Cargo.lock，创建 Conventional Commit 和附注标签，原子推送分支和标签。本地不安装依赖或构建。

迁移分支需先合入 main 再正式发布。如果首次沿用 0.0.1，可直接在已验证的 main 提交打标签：

```bash
git tag -a v0.0.1 -m "Release v0.0.1"
git push origin v0.0.1
```

失败后检查 git status、git log -1、git tag，避免重复递增版本；仅推送失败时解决原因后重新推送原标签。不要移动已经公开的标签。

## GitHub Actions

推送 v* 标签后，工作流会：

1. 安装 Node/Rust 依赖，运行格式、类型、前端测试和 Rust 测试。
2. 验证标签与 package.json 版本，检查签名和公证凭证。
3. 使用 tauri-action 构建并签名、公证应用，创建 Release 草稿。
4. 上传 DMG、Tauri 更新归档 `.app.tar.gz`、`.sig` 及 `latest.json`。
5. 前置步骤成功后自动公开 Release。

手动 Run workflow 只构建测试安装包并上传 Actions artifact，不发布 Release。

```bash
gh run list --workflow build-mac.yml --event push --limit 5
# 替换运行 ID 和版本
gh run watch 123456789 --exit-status
gh release view v0.0.1 --web
```

## Updater 验收

应用启动以及每 6 小时自动检查；About 支持手动检查。用户点击下载后获取更新，确认重启安装后才安装。生成过程中禁止安装。更新检查地址为 GitHub Releases latest/download/latest.json。

更新文件必须属于同一构建，签名、公钥、版本和架构必须匹配。Tauri 不使用 Electron 的 latest-mac.yml、ZIP 或 blockmap。不要混放旧 Electron 更新元数据。

先安装签名版本 A，再发布更高版本 B，验证发现更新、下载进度、网络失败重试、确认安装、重启后版本和数据保留。开发模式和未配置公钥的本地包不能替代此验收。没有真实签名 A/B 测试前，不应声称自动更新已端到端验证。

模型能力表独立更新见 [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)。

参考：[Tauri updater](https://v2.tauri.app/plugin/updater/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)。
