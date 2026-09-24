# 发布流程

本文对应当前 [macOS 工作流](.github/workflows/build-mac.yml)。发布入口是推送 `v*` Git 标签：CI 构建、签名、公证并上传 GitHub Release 草稿，维护者检查后再公开发布。无需提前在 GitHub 创建 Release。

## 1. 首次配置

在仓库 **Settings → Secrets and variables → Actions → Repository secrets** 配置：

| Secret                        | 内容                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `MAC_CERTIFICATE_BASE64`      | 包含私钥的 Developer ID Application `.p12` 文件的 Base64 |
| `MAC_CERTIFICATE_PASSWORD`    | 导出 `.p12` 时设置的密码                                 |
| `APPLE_ID`                    | Apple Developer 账号邮箱                                 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的 App 专用密码，用于公证                          |
| `APPLE_TEAM_ID`               | 证书所属 Apple Developer Team ID                         |

在 macOS 上将证书编码并复制到剪贴板，然后粘贴到对应 Secret：

```bash
base64 -i /path/to/DeveloperIDApplication.p12 | pbcopy
```

证书须在有效期内，并包含可用私钥；`.p12` 是容器，有效期取决于其中的证书。证书、密码和编码内容不要提交到仓库。

工作流已有 `contents: write` 权限，并将 GitHub Actions 自动提供的 `secrets.GITHUB_TOKEN` 映射为 `GH_TOKEN`。通常无需创建个人访问令牌，也无需手动创建名为 `GITHUB_TOKEN` 的 Secret。若出现权限错误，检查仓库或组织的 Actions 策略。

签名使用临时钥匙串：`.p12` 密码用于导入证书，随机生成的钥匙串密码用于解锁和设置私钥访问权限。详情见 [BUILD.md](BUILD.md#ci-钥匙串)。

## 2. 可选：先试构建

进入仓库 **Actions → Build macOS DMG → Run workflow**，选择要验证的分支。

手动运行会执行校验、签名和打包，在运行页面生成 `hamster-studio-macos` artifact，里面包含 DMG、ZIP 及生成的更新文件；不会创建或上传 GitHub Release，即使手动运行选择的是标签也一样。手动 CI 构建同样需要签名 Secrets。

下载 DMG 后安装测试，确认聊天、图片生成与导出、历史会话和语言切换正常。检查构建日志中的签名与公证结果。

## 3. 准备版本

以下命令在仓库根目录执行。以发布 `0.1.1` 为例，请替换成实际版本；先确保工作区干净。

```bash
git switch main
git pull --ff-only origin main
git status --short
npm ci
npm version 0.1.1 --no-git-tag-version
npm run format:check
npm run typecheck
npm test
npm run build:renderer
```

`npm version --no-git-tag-version` 更新 `package.json` 和 `package-lock.json`，不会自动提交或打标签。检查版本修改后提交：

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "chore(release): prepare v0.1.1"
git push origin main
```

如果首次发布的版本已经是 `0.1.0`，保留现有版本即可，跳过修改版本和空提交步骤，仍需完成验证。

## 4. 创建并推送标签

标签必须指向已验证的发布提交，且与 `package.json` 版本一致：版本 `0.1.1` 对应标签 `v0.1.1`。CI 会检查标签与应用版本是否一致，不一致将停止发布。

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin v0.1.1
```

只有把标签推送到远端才会触发发布构建；普通提交推送不会触发该 macOS 工作流。只推送本次标签即可。

在 [Actions](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml) 查看执行结果。工作流会依次安装依赖、导入证书、检查格式与类型、运行测试、编译，然后使用 `electron-builder --mac dmg zip --arm64 --publish always` 打包并上传。

当前 CI 固定构建 Apple Silicon（arm64），同时输出 DMG 和 ZIP。尚未提供 Intel Mac 更新包；不要将此版本描述为同时支持两种架构。

## 5. 检查草稿并正式发布

当前配置采用 electron-builder 的默认 Release 草稿行为。CI 成功不代表版本已公开；到 [Releases](https://github.com/xrdavies/hamster-studio/releases) 找到对应草稿。

1. 确认标签、版本号、产物架构和待发布提交一致。
2. 确认 Assets 中有 DMG、macOS ZIP，以及构建生成的 `.blockmap`、`latest-mac.yml` 等相关文件；保留生成的更新文件。
3. 下载这次 Release 草稿中的 DMG，安装并启动验证。不要用 GitHub 自动生成的 Source code 压缩包代替安装包。
4. 确认签名与公证成功。将应用安装到“应用程序”后可执行：

   ```bash
   codesign --verify --deep --strict --verbose=2 "/Applications/Hamster Studio.app"
   spctl --assess --type execute --verbose=2 "/Applications/Hamster Studio.app"
   xcrun stapler validate "/Applications/Hamster Studio.app"
   ```

5. 填写更新说明：主要变化、问题修复、支持的系统与架构、已知限制、安装方式。测试版本勾选 **Set as a pre-release**。
6. 点击 **Publish release**，确认公开页面可以下载安装包。

Release 标题可用 `Hamster Studio v0.1.1`。发布后同步中英文 README 的下载状态，移除“尚未发布公开版本”等过期说明。

## 6. 应用内更新

安装版启动时自动检查一次，此后每 6 小时检查；设置 → About → 检查更新也可手动触发。当前只订阅正式发布，不接收草稿或预发布版本，不允许降级。

1. 发现新版后出现提示，用户点击“下载更新”才开始下载。
2. 界面显示下载进度，下载失败显示错误，可重新检查并重试。
3. 下载完成后点击“重启并安装”，确认后退出并安装；普通退出不会主动触发本应用的安装操作。
4. 有聊天或图片生成请求运行时禁止重启安装，先结束或停止请求。安装前保存设置；未发送草稿仅在内存中，不会跨重启保留。

本地开发模式不检查真实更新。必须使用已签名的安装版，在“应用程序”目录运行来验证 macOS 升级。

### 更新包发布要求

- 提升 `package.json` / `package-lock.json` 版本，并推送同版本 `v*` 标签，按前文发布流程执行。
- CI 使用 `--mac dmg zip --arm64`；ZIP 是 macOS updater 必需的更新载体，DMG 用于首次安装。
- 保留本次构建生成的 ZIP、DMG、`.blockmap` 和 `latest-mac.yml`。不要混用不同构建的文件，不要手工修改哈希或改名附件。
- `latest-mac.yml` 中引用的 ZIP 必须存在于同一公开 Release，版本、文件名、大小和 SHA-512 必须匹配。GitHub 自动生成的源码 ZIP 无法替代应用 ZIP。
- 保持 `appId`、GitHub 发布仓库和签名身份连续一致。配置仍使用现有 Apple 签名与公证 Secrets，发布包须签名、公证成功。
- 检查草稿安装包后再点击 **Publish release**。仅上传 Actions artifact 或保留草稿不会对用户开放更新。

macOS ZIP 与签名要求见 [electron-builder v26 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)。

### 首次上线与验收

旧版本尚无完整更新交互，首次切换需要用户手动下载安装包含本次 updater 的版本 A。之后发布更高版本 B，用已安装的 A 完成以下验收：

- 启动自动发现 B；取消或稍后不会下载或重启，About 仍可操作。
- 手动检查能发现 B，重复点击不会并行下载。
- 下载过程中断网可看到错误，恢复网络后可重试。
- 下载完成但未确认时不主动重启；生成期间安装被阻止。
- 确认安装后重新启动，About 显示 B，Provider、会话与生成图片仍在。
- B 再检查应显示最新版本；草稿和预发布版本不会推送给普通用户。

自动化测试使用模拟更新服务覆盖状态与确认流程，不能代替真实 Apple 签名包的 A → B 升级验证。

模型能力表独立于应用版本更新，维护与发布方式见 [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md)。

## 7. 失败处理

| 现象                           | 检查与处理                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GH_TOKEN` 未设置              | 确认标签指向的提交已包含当前发布工作流，发布步骤映射了 `secrets.GITHUB_TOKEN`；手动构建应使用 `--publish never`。 |
| `403` / 无法上传 Release       | 检查 `contents: write` 和组织的 Actions 权限策略。                                                                |
| `SecKeychainUnlock` / 密码错误 | 区分 `.p12` 密码与临时钥匙串密码；使用当前显式导入钥匙串的流程，不额外配置 `CSC_LINK`。                           |
| 找不到签名身份                 | 检查证书是否为 Developer ID Application、是否包含私钥、密码及有效期是否正确。                                     |
| 公证失败或未执行               | 检查三个 Apple Secrets 是否齐全、账号与 Team ID 是否匹配，并查看打包和 Apple 公证日志。                           |
| CI 成功但用户看不到版本        | 检查 Release 是否仍为草稿，是否已点击 Publish release。                                                           |
| 更新提示缺少 ZIP               | 检查 Release 是否包含本次构建的 ZIP 和匹配的 latest-mac.yml。                                                     |

网络临时故障或修正 Secrets 后，可以在原来的**标签 push 运行记录**中选择 **Re-run failed jobs**；必要时 **Re-run all jobs**。不要用 Run workflow 代替发布重试，它只构建 artifact。

重跑使用原标签提交中的工作流。若需修改代码或工作流，先提交修复，再发布新的版本与标签；不要移动已经公开的标签。已公开版本发现问题时发布更高版本修复，避免覆盖用户已经下载的包。

## 参考

- [electron-builder 发布配置与草稿行为](https://www.electron.build/publish/)
- [GitHub Releases 概念](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
