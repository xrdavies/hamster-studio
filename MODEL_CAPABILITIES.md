# 模型能力表

内置表位于 `config/model-capabilities.json`，随软件打包。设置 → Providers → 模型能力表可检查 GitHub 上的新规则并点击“下载并应用”，无需发布新版应用。

## 分类规则

聊天是默认类型，不需要逐个配置聊天模型。配置表只维护图片生成模型的精确 ID 和前缀：

1. 优先匹配配置表中的精确 ID，再匹配最长前缀。
2. 未命中规则时，识别 Provider 的 `type: "image"` 或 `capabilities.image_generation: true`。
3. 其余模型默认归为聊天模型，可直接选择使用。

手动添加和从 Provider 获取使用相同规则。已有未知模型会重新归为聊天；图片规则可以纠正旧列表中错误归为聊天的模型。表更新不会增删用户模型或修改历史消息。默认聊天是接口路由策略，不保证任意模型都支持聊天接口；视频、音频等接口仍不受支持。

ID 区分大小写，不使用模糊的 image 子串匹配。图片规则只用于支持图片生成接口的模型，视觉理解模型仍属于聊天。旧表中的显式 chat 条目仍可读取，但维护新表时无需添加。

## 配置格式

```json
{
  "schemaVersion": 1,
  "version": 3,
  "models": {
    "gpt-image-2": "image"
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
