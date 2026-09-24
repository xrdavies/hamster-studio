import en from '../shared/locales/en.json'
import { aboutUrl } from '../shared/about'
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Store } from './storage'
import { autoUpdater } from 'electron-updater'
import { classifyProviderModels, providerUrl } from './provider'
import type { Message, ProviderInput, ProviderModels, StudioSession } from '../shared/types'

let win: BrowserWindow
let store: Store
const activeChats = new Map<string, AbortController>()
const currentDir = __dirname

function message(
  sessionId: string,
  role: Message['role'],
  content: string,
  model: string,
  providerName: string,
  status: Message['status'] = 'done',
  kind: Message['kind'] = 'chat',
): Message {
  return {
    id: randomUUID(),
    sessionId,
    role,
    kind,
    content,
    imageFiles: [],
    providerName,
    model,
    createdAt: Date.now(),
    status,
    error: '',
  }
}

async function jsonRequest(baseUrl: string, key: string, path: string, body: unknown) {
  const response = await fetch(providerUrl(baseUrl, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  if (!response.ok)
    throw new Error(`Provider 请求失败（${response.status}）: ${await response.text()}`)
  return response.json()
}

async function fetchProviderModels(input: ProviderInput): Promise<ProviderModels> {
  const key = input.id ? store.providerKey(input.id) : input.apiKey?.trim()
  if (!key) throw new Error('请先填写 API Key')
  const response = await fetch(providerUrl(input.baseUrl, '/models'), {
    headers: { Authorization: 'Bearer ' + key },
  })
  if (!response.ok)
    throw new Error('模型列表请求失败（' + response.status + '）: ' + (await response.text()))
  return classifyProviderModels(await response.json())
}

async function streamChat(sessionId: string, text: string) {
  const session = store.session(sessionId)
  const provider = store.provider(session.providerId)
  const key = store.providerKey(provider.id)
  if (!key) throw new Error('请先在设置中填写 API Key')
  const history = store
    .history(sessionId)
    .map((item) => ({ role: item.role, content: item.content }))
  const user = message(sessionId, 'user', text, session.chatModel, provider.name)
  store.saveMessage(user)
  win.webContents.send('message', user)
  const assistant = message(
    sessionId,
    'assistant',
    '',
    session.chatModel,
    provider.name,
    'streaming',
  )
  store.saveMessage(assistant)
  win.webContents.send('message', assistant)
  const controller = new AbortController()
  activeChats.set(sessionId, controller)
  const response = await fetch(providerUrl(provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: session.chatModel,
      stream: true,
      messages: [
        ...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []),
        ...history,
        { role: 'user', content: text },
      ],
    }),
    signal: controller.signal,
  })
  if (!response.ok || !response.body)
    throw new Error(`聊天请求失败（${response.status}）: ${await response.text()}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content || ''
        if (delta) {
          assistant.content += delta
          store.saveMessage(assistant)
          win.webContents.send('message', assistant)
        }
      } catch {
        /* Ignore incomplete SSE frames. */
      }
    }
  }
  assistant.status = 'done'
  store.saveMessage(assistant)
  win.webContents.send('message', assistant)
  activeChats.delete(sessionId)
}

async function generateImage(sessionId: string, prompt: string) {
  const session = store.session(sessionId)
  const provider = store.provider(session.providerId)
  const key = store.providerKey(provider.id)
  if (!key) throw new Error('请先在设置中填写 API Key')
  if (!session.imageModel) throw new Error('当前 Session 没有配置图片模型')
  const user = message(
    sessionId,
    'user',
    prompt,
    session.imageModel,
    provider.name,
    'done',
    'image',
  )
  store.saveMessage(user)
  win.webContents.send('message', user)
  const image = message(
    sessionId,
    'assistant',
    '',
    session.imageModel,
    provider.name,
    'streaming',
    'image',
  )
  store.saveMessage(image)
  win.webContents.send('message', image)
  const result = await jsonRequest(provider.baseUrl, key, '/images/generations', {
    model: session.imageModel,
    prompt,
    n: 1,
    response_format: 'b64_json',
  })
  const data = result.data?.[0]
  if (!data) throw new Error('Provider 未返回图片')
  const bytes = data.b64_json
    ? Buffer.from(data.b64_json, 'base64')
    : data.url
      ? Buffer.from(await (await fetch(data.url)).arrayBuffer())
      : null
  if (!bytes) throw new Error('Provider 返回的图片格式不支持')
  const dir = join(app.getPath('userData'), 'images')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.png`)
  await writeFile(file, bytes)
  image.status = 'done'
  image.imageFiles = [pathToFileURL(file).href]
  store.saveMessage(image)
  win.webContents.send('message', image)
  return image
}

let uiLanguage = 'zh'
function registerIpc() {
  ipcMain.handle('app:language', (_event, value: string) => {
    if (value !== 'zh' && value !== 'en') throw new Error('Invalid language')
    uiLanguage = value
  })
  ipcMain.handle('app:open-link', (_event, key: string) => shell.openExternal(aboutUrl(key)))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:updates', async () => {
    if (!app.isPackaged) return '开发版本不支持自动更新，请使用安装版检查更新。'
    const result = await autoUpdater.checkForUpdates()
    if (!result) return '更新服务暂不可用'
    return result.updateInfo.version === app.getVersion()
      ? '当前已是最新版本'
      : uiLanguage === 'en'
        ? `Version ${result.updateInfo.version} is downloading. Restart after download to install.`
        : `发现新版本 ${result.updateInfo.version}，正在后台下载。下载后重启应用安装。`
  })
  ipcMain.handle('data', () => store.data())
  ipcMain.handle('provider:save', (_e, input: ProviderInput) => {
    const id = store.saveProvider(input)
    return store.data().providers.find((p) => p.id === id)
  })
  ipcMain.handle('provider:delete', (_e, id: string) => store.deleteProvider(id))
  ipcMain.handle(
    'session:save',
    (_e, session: Partial<StudioSession> & Pick<StudioSession, 'providerId' | 'chatModel'>) => {
      store.saveSession(session)
      return store.data()
    },
  )
  ipcMain.handle('session:delete', (_e, id: string) => {
    store.deleteSession(id)
    return store.data()
  })
  ipcMain.handle('chat:send', async (_e, id: string, text: string) => {
    try {
      await streamChat(id, text.trim())
    } catch (error) {
      activeChats.delete(id)
      store.failStreaming(
        id,
        error instanceof Error && error.name === 'AbortError'
          ? '已停止生成'
          : error instanceof Error
            ? error.message
            : '请求失败',
      )
      throw error
    }
    return store.data()
  })
  ipcMain.handle('chat:stop', (_e, id: string) => activeChats.get(id)?.abort())
  ipcMain.handle('image:generate', async (_e, id: string, prompt: string) => {
    try {
      await generateImage(id, prompt.trim())
    } catch (error) {
      store.failStreaming(id, error instanceof Error ? error.message : '图片生成失败')
      throw error
    }
    return store.data()
  })
  const localImagePath = (file: string) => {
    const imageDir = join(app.getPath('userData'), 'images')
    const resolved = file.startsWith('file:') ? fileURLToPath(file) : file
    if (!resolved.startsWith(imageDir + '/')) throw new Error('图片路径无效')
    return resolved
  }
  ipcMain.handle('image:read', async (_e, file: string) => {
    const bytes = await readFile(localImagePath(file))
    return 'data:image/png;base64,' + bytes.toString('base64')
  })
  ipcMain.handle('image:export', async (_e, file: string) => {
    const source = localImagePath(file)
    const result = await dialog.showSaveDialog(win, {
      title: uiLanguage === 'en' ? en['导出图片'] : '导出图片',
      defaultPath: 'hamster-image.png',
      filters: [{ name: uiLanguage === 'en' ? en['PNG 图片'] : 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    await copyFile(source, result.filePath)
    return true
  })
  ipcMain.handle('provider:test', async (_e, input: ProviderInput) => {
    const key = input.id ? store.providerKey(input.id) : input.apiKey?.trim()
    if (!key) throw new Error('请填写 API Key')
    const result = await fetch(providerUrl(input.baseUrl, '/models'), {
      headers: { Authorization: 'Bearer ' + key },
    })
    if (!result.ok) throw new Error(`连接失败（${result.status}）`)
    return true
  })
  ipcMain.handle('provider:models', (_e, input: ProviderInput) => fetchProviderModels(input))
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Hamster Studio',
    icon: join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: join(currentDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else await win.loadFile(join(currentDir, '../dist/index.html'))
}

app.whenReady().then(() => {
  app.setName('Hamster Studio')
  if (process.platform === 'darwin') app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Hamster Studio',
        submenu: [
          { role: 'about', label: '关于 Hamster Studio' },
          { type: 'separator' },
          { role: 'quit', label: '退出 Hamster Studio' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
  const key = 'hamster-studio-key'
  const encrypt = (value: string) =>
    safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value)
  const decrypt = (value: Buffer) =>
    safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(value) : value.toString()
  store = new Store(join(app.getPath('userData'), 'studio.db'), encrypt, decrypt)
  registerIpc()
  createWindow()
  autoUpdater.on('error', () => {})
  if (app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')))
    autoUpdater.checkForUpdatesAndNotify().catch(() => {})
})
app.on('window-all-closed', () => {
  store?.close()
  if (process.platform !== 'darwin') app.quit()
})
