import type { Message, ProviderInput, StudioData, StudioSession } from '../shared/types'
declare global {
  interface Window {
    studio: {
      openAboutLink(key: string): Promise<void>
      version(): Promise<string>
      checkUpdates(): Promise<string>
      load(): Promise<StudioData>
      saveProvider(input: ProviderInput): Promise<unknown>
      deleteProvider(id: string): Promise<void>
      saveSession(
        session: Partial<StudioSession> & Pick<StudioSession, 'providerId' | 'chatModel'>,
      ): Promise<StudioData>
      deleteSession(id: string): Promise<StudioData>
      sendChat(sessionId: string, text: string): Promise<StudioData>
      stopChat(sessionId: string): Promise<void>
      generateImage(sessionId: string, prompt: string): Promise<StudioData>
      readImage(file: string): Promise<string>
      exportImage(file: string): Promise<boolean>
      fetchModels(input: ProviderInput): Promise<{ chatModels: string[]; imageModels: string[] }>
      testProvider(input: ProviderInput): Promise<boolean>
      onMessage(callback: (message: Message) => void): () => void
    }
  }
}
export {}
