import { contextBridge, ipcRenderer } from 'electron'
import type { Message, ProviderInput, ProviderModels, StudioData, StudioSession } from '../shared/types'

contextBridge.exposeInMainWorld('studio', {
  load: (): Promise<StudioData> => ipcRenderer.invoke('data'),
  saveProvider: (input: ProviderInput) => ipcRenderer.invoke('provider:save', input),
  deleteProvider: (id: string) => ipcRenderer.invoke('provider:delete', id),
  saveSession: (session: Partial<StudioSession> & Pick<StudioSession, 'providerId' | 'chatModel'>) => ipcRenderer.invoke('session:save', session),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
  sendChat: (sessionId: string, text: string) => ipcRenderer.invoke('chat:send', sessionId, text),
  stopChat: (sessionId: string) => ipcRenderer.invoke('chat:stop', sessionId),
  generateImage: (sessionId: string, prompt: string) => ipcRenderer.invoke('image:generate', sessionId, prompt),
  fetchModels: (input: ProviderInput) => ipcRenderer.invoke('provider:models', input) as Promise<ProviderModels>,
  testProvider: (input: ProviderInput) => ipcRenderer.invoke('provider:test', input),
  onMessage: (callback: (message: Message) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Message) => callback(message)
    ipcRenderer.on('message', listener)
    return () => ipcRenderer.removeListener('message', listener)
  }
})
