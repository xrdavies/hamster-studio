# 模型能力表

内置表位于 `config/model-capabilities.json`，随软件打包。设置 → Providers → 模型能力表可检查 GitHub 上的新规则并点击“下载并应用”，无需发布新版应用。

## 分类规则

1. `models` 中精确匹配的模型 ID。
2. Provider 返回的 `type: "image"`、`type: "chat"` 或 `capabilities.image_generation: true`。
3. `prefixes` 中最长的匹配前缀。
4. 未匹配模型标为未知，保留在 Provider 列表中，暂不进入生成模型菜单。

ID 区分大小写，不使用模糊的 `image` 子串匹配。手动添加模型与 Provider 拉取使用同一份表。Provider 能力字段是可选扩展，并非所有中转站都会提供。应只维护确实通过聊天或图片生成接口工作的规则；视觉理解不等于图片生成。当前只支持一种主要能力，不支持视频、语音等接口。

已保存 Provider 的分类作为既有能力提示保留，精确规则可覆盖旧分类；重新获取模型可刷新 Provider 的提示。更新表不会添加、删除用户的模型，不会改写历史消息。会话仍保留原来的模型选择；若能力变化，发送会提示重新选择。

## 配置格式

```json
{
  "schemaVersion": 1,
  "version": 2,
  "models": {
    "gpt-image-2": "image",
    "my-relay-chat-alias": "chat"
  },
  "prefixes": [{ "prefix": "gpt-image-", "kind": "image" }]
}
```

这是格式示例，维护时请在完整现有表上修改。别名规则对所有 Provider 生效；不要加入不同中转站含义冲突的通用别名。

- `schemaVersion` 当前必须为 `1`。
- 每次修改递增正整数 `version`；只接受比本地更高的版本。
- `models` 值和 `prefixes.kind` 只能为 `chat` 或 `image`。
- 不允许空 ID 或前缀；每项最长 200 字符。最多 10000 个精确 ID、1000 个前缀，远端内容不超过 1 MB。
- 修正规则需要再次递增版本；降低版本不会触发回退。

## 发布规则更新

1. 修改 `config/model-capabilities.json` 并递增 `version`。
2. 运行 `npm run format:check`、`npm run typecheck` 和 `npm test`。
3. 提交并推送到 `main`。无需创建应用版本标签。
4. 在旧版本应用的 Providers 设置页检查，确认新版本可见，应用后核对模型分类。

固定远端地址：`https://raw.githubusercontent.com/xrdavies/hamster-studio/main/config/model-capabilities.json`。

检查时下载并校验 JSON 以比较版本，但不会自动应用。点击“下载并应用”后将已检查的内容原子写入应用数据目录的 `model-capabilities.json`。重启时使用内置表和有效缓存中版本较高的一份；断网、无效响应和损坏缓存均不会破坏内置表。检查仅在用户点击时执行，不发送 Provider URL、API Key 或对话数据。
