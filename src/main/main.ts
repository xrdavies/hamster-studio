import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from './storage'
import type { Message, ProviderInput, StudioSession } from '../shared/types'

let win: BrowserWindow
let store: Store
const currentDir = __dirname
const url = (base: string, path: string) => `${base.replace(/\/+$/, '')}${base.endsWith('/v1') ? '' : '/v1'}${path}`

function message(sessionId: string, role: Message['role'], content: string, model: string, providerName: string, status: Message['status'] = 'done', kind: Message['kind'] = 'chat'): Message {
  return { id: randomUUID(), sessionId, role, kind, content, imageFiles: [], providerName, model, createdAt: Date.now(), status, error: '' }
}

async function jsonRequest(baseUrl: string, key: string, path: string, body: unknown) {
  const response = await fetch(url(baseUrl, path), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`Provider 请求失败（${response.status}）: ${await response.text()}`)
  return response.json()
}

async function streamChat(sessionId: string, text: string) {
  const session = store.session(sessionId)
  const provider = store.provider(session.providerId)
  const key = store.providerKey(provider.id)
  if (!key) throw new Error('请先在设置中填写 API Key')
  const history = store.history(sessionId).map(item => ({ role: item.role, content: item.content }))
  const user = message(sessionId, 'user', text, session.chatModel, provider.name)
  store.saveMessage(user); win.webContents.send('message', user)
  const assistant = message(sessionId, 'assistant', '', session.chatModel, provider.name, 'streaming')
  store.saveMessage(assistant); win.webContents.send('message', assistant)
  const response = await fetch(url(provider.baseUrl, '/chat/completions'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: session.chatModel, stream: true, messages: [...(session.systemPrompt ? [{ role: 'system', content: session.systemPrompt }] : []), ...history, { role: 'user', content: text }] })
  })
  if (!response.ok || !response.body) throw new Error(`聊天请求失败（${response.status}）: ${await response.text()}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content || ''
        if (delta) { assistant.content += delta; store.saveMessage(assistant); win.webContents.send('message', assistant) }
      } catch { /* Ignore incomplete SSE frames. */ }
    }
  }
  assistant.status = 'done'; store.saveMessage(assistant); win.webContents.send('message', assistant)
}

async function generateImage(sessionId: string, prompt: string) {
  const session = store.session(sessionId); const provider = store.provider(session.providerId); const key = store.providerKey(provider.id)
  if (!key) throw new Error('请先在设置中填写 API Key')
  if (!session.imageModel) throw new Error('当前 Session 没有配置图片模型')
  const result = await jsonRequest(provider.baseUrl, key, '/images/generations', { model: session.imageModel, prompt, n: 1, response_format: 'b64_json' })
  const data = result.data?.[0]; if (!data) throw new Error('Provider 未返回图片')
  const bytes = Buffer.from(data.b64_json, 'base64'); const dir = join(app.getPath('userData'), 'images'); await mkdir(dir, { recursive: true })
  const file = join(dir, `${randomUUID()}.png`); await writeFile(file, bytes)
  const image = message(sessionId, 'assistant', prompt, session.imageModel, provider.name, 'done', 'image'); image.imageFiles = [file]
  store.saveMessage(image); win.webContents.send('message', image); return image
}

function registerIpc() {
  ipcMain.handle('data', () => store.data())
  ipcMain.handle('provider:save', (_e, input: ProviderInput) => { const id = store.saveProvider(input); return store.data().providers.find(p => p.id === id) })
  ipcMain.handle('provider:delete', (_e, id: string) => store.deleteProvider(id))
  ipcMain.handle('session:save', (_e, session: Partial<StudioSession> & Pick<StudioSession, 'providerId' | 'chatModel'>) => { store.saveSession(session); return store.data() })
  ipcMain.handle('session:delete', (_e, id: string) => { store.deleteSession(id); return store.data() })
  ipcMain.handle('chat:send', async (_e, id: string, text: string) => { await streamChat(id, text.trim()); return store.data() })
  ipcMain.handle('image:generate', async (_e, id: string, prompt: string) => { await generateImage(id, prompt.trim()); return store.data() })
  ipcMain.handle('provider:test', async (_e, input: ProviderInput) => {
    if (!input.apiKey) throw new Error('请填写 API Key')
    const result = await fetch(url(input.baseUrl, '/models'), { headers: { Authorization: `Bearer ${input.apiKey}` } })
    if (!result.ok) throw new Error(`连接失败（${result.status}）`)
    return true
  })
}

async function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 600, webPreferences: { preload: join(currentDir, 'preload.mjs'), contextIsolation: true, nodeIntegration: false } })
  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else await win.loadFile(join(currentDir, '../dist/index.html'))
}

app.whenReady().then(() => {
  const key = 'hamster-studio-key'
  const encrypt = (value: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value)
  const decrypt = (value: Buffer) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(value) : value.toString()
  store = new Store(join(app.getPath('userData'), 'studio.db'), encrypt, decrypt)
  registerIpc(); createWindow()
})
app.on('window-all-closed', () => { store?.close(); if (process.platform !== 'darwin') app.quit() })
