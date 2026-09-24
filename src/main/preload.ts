import type { UpdateState } from '../shared/updates'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  Message,
  ProviderInput,
  ProviderModels,
  StudioData,
  StudioSession,
} from '../shared/types'

contextBridge.exposeInMainWorld('studio', {
  setLanguage: (value: string) => ipcRenderer.invoke('app:language', value) as Promise<void>,
  openAboutLink: (key: string) => ipcRenderer.invoke('app:open-link', key) as Promise<void>,
  version: () => ipcRenderer.invoke('app:version') as Promise<string>,
  checkUpdates: () => ipcRenderer.invoke('app:updates'),
  updateState: () => ipcRenderer.invoke('app:update-state'),
  downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  catalogState: () => ipcRenderer.invoke('catalog:state'),
  checkCatalog: () => ipcRenderer.invoke('catalog:check'),
  installCatalog: () => ipcRenderer.invoke('catalog:install'),
  classifyModels: (models: string[]) => ipcRenderer.invoke('catalog:classify', models),
  onUpdate: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('app:update-state', listener)
    return () => ipcRenderer.removeListener('app:update-state', listener)
  },
  load: (): Promise<StudioData> => ipcRenderer.invoke('data'),
  saveProvider: (input: ProviderInput) => ipcRenderer.invoke('provider:save', input),
  deleteProvider: (id: string) => ipcRenderer.invoke('provider:delete', id),
  saveSession: (session: Partial<StudioSession>) => ipcRenderer.invoke('session:save', session),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
  sendChat: (sessionId: string, text: string) => ipcRenderer.invoke('chat:send', sessionId, text),
  stopChat: (sessionId: string) => ipcRenderer.invoke('chat:stop', sessionId),
  generateImage: (sessionId: string, prompt: string) =>
    ipcRenderer.invoke('image:generate', sessionId, prompt),
  readImage: (file: string) => ipcRenderer.invoke('image:read', file) as Promise<string>,
  exportImage: (file: string) => ipcRenderer.invoke('image:export', file) as Promise<boolean>,
  fetchModels: (input: ProviderInput) =>
    ipcRenderer.invoke('provider:models', input) as Promise<ProviderModels>,
  testProvider: (input: ProviderInput) => ipcRenderer.invoke('provider:test', input),
  onMessage: (callback: (message: Message) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Message) => callback(message)
    ipcRenderer.on('message', listener)
    return () => ipcRenderer.removeListener('message', listener)
  },
})
