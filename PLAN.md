# Hamster Studio 方案

## 最终方案

新建独立的 Hamster Studio 项目，不裁剪 `hamster-art`。新项目采用本地优先架构，`hamster-art` 只作为 UI、Electron 配置、Provider 请求和交互参考。

远端仓库：`git@github.com:xrdavies/hamster-studio.git`

## 产品边界

只支持：

- 多 Provider 配置
- 多 Session 管理
- 文本聊天
- 图片生成

不支持登录、认证服务器、远程同步、Agent、工具调用、插件、MCP、工作流、定时任务、知识库、IM、代码执行和视频生成。

## 技术选型

使用 **Electron + React + TypeScript + Vite**。桌面网络请求、流式响应、文件保存和密钥处理全部由 Electron 主进程负责。

## 架构

```text
React Renderer
    | IPC
    v
Electron Main
    +-- Provider Adapter
    +-- Session Store
    +-- Secret Store
    +-- Image/File Store
```

Renderer 只负责界面，不直接持有 API Key，也不直接请求 Provider。Electron Main 负责网络请求、流式响应、密钥读取、Session 存储和图片写入。

## Provider

当前只支持用户配置的自定义中转站，接口使用 OpenAI Compatible 协议。Provider 配置包含显示名称、API Key、Base URL、聊天模型和图片模型。

不内置 OpenAI、Anthropic、Gemini 或其他厂商的专用 Provider；用户通过 Base URL 接入兼容服务。

最小接口：

```text
chat()
streamChat()
generateImage()
listModels()
```

## Session

Provider 配置是全局资源，Session 只引用 Provider。

Session 字段：

```text
id
title
createdAt
updatedAt
providerId
model
messages
systemPrompt
```

消息字段：

```text
id
role
text
images
createdAt
status
error
providerId
model
```

创建 Session 时选择 Provider 和模型；Session 过程中可以切换 Provider、聊天模型和图片模型。历史消息保留，新请求使用当前选择；每条 assistant 消息记录实际使用的 Provider 和模型。

## 图片生成

图片生成独立于聊天请求。生成结果保存为本地文件，消息只保存路径、尺寸和必要元数据。第一版支持提示词、Provider、图片模型、尺寸和数量；暂不实现局部重绘、参考图、工作流和云端图库。

## 本地数据和密钥

使用 SQLite 保存 Provider、Session 和消息，核心表为 `providers`、`sessions`、`messages`。

API Key 使用 Electron `safeStorage` 或系统 Keychain / Credential Manager 加密保存。普通配置文件不保存明文密钥。Provider 配置导出不包含 API Key。

## UI

左侧栏：新建 Session、Session 列表、设置。

主区域：当前 Provider / 模型、消息列表、输入框、发送按钮、图片生成入口。

设置页：Provider 列表、添加和编辑、API Key、Base URL、连接测试、模型管理。

## 建议目录

```text
src/
  main/
    ipc/
    providers/
    storage/
    secrets/
    files/
    main.ts
    preload.ts
  renderer/
    components/
    pages/
      ChatPage.tsx
      SettingsPage.tsx
    store/
    services/
    App.tsx
  shared/
    types.ts
    providerTypes.ts
    ipcTypes.ts
```

## 实施顺序

1. Electron 壳、自定义 OpenAI Compatible Provider、API Key / Base URL、单 Session、流式聊天和本地历史。
2. 多 Provider、多 Session、创建时选择 Provider / 模型、Session 内切换、连接测试和编辑删除。
3. 图片模型、图片生成、本地保存、图片消息、重新生成和保存。
4. 搜索、配置导入导出、Markdown、复制、重试、中断、失败恢复和自动更新。

## 项目边界

新项目不引入 `hamster-art` 的 auth、OpenClaw、Cowork、Agent、Skill、IM、MCP、远程服务、知识库、定时任务和旧版全局 Store。Provider 请求、Session 存储、密钥管理和 IPC 都在新项目中独立实现。
