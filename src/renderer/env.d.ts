import type { UpdateState, CatalogState } from '../shared/updates'
import type { ProviderModels } from '../shared/types'
import type { Message, ProviderInput, StudioData, StudioSession } from '../shared/types'
declare global {
  interface Window {
    studio: {
      preflightSkill(sessionId: string, images: number, mask: boolean): Promise<string[]>
      listSkills(): Promise<import('../shared/types').Skill[]>
      saveSkill(skill: import('../shared/types').Skill): Promise<import('../shared/types').Skill>
      setLanguage(value: string): Promise<void>
      openAboutLink(key: string): Promise<void>
      version(): Promise<string>
      checkUpdates(): Promise<UpdateState>
      updateState(): Promise<UpdateState>
      downloadUpdate(): Promise<UpdateState>
      installUpdate(): Promise<void>
      onUpdate(callback: (state: UpdateState) => void): () => void
      catalogState(): Promise<CatalogState>
      checkCatalog(): Promise<CatalogState>
      installCatalog(): Promise<CatalogState>
      classifyModels(models: string[]): Promise<ProviderModels>
      load(): Promise<StudioData>
      saveProvider(input: ProviderInput): Promise<unknown>
      deleteProvider(id: string): Promise<void>
      saveSession(session: Partial<StudioSession>): Promise<StudioData>
      deleteSession(id: string): Promise<StudioData>
      continueAgent(sessionId: string, messageId: string): Promise<StudioData>
      approveImageStep(sessionId: string, stepId: string, allow: boolean): Promise<void>
      sendChat(
        sessionId: string,
        text: string,
        referenceFiles?: string[],
        maskFile?: string,
      ): Promise<StudioData>
      stopChat(sessionId: string): Promise<void>
      generateImage(
        sessionId: string,
        prompt: string,
        referenceFiles?: string[],
        maskFile?: string,
      ): Promise<StudioData>
      onImageDrag(
        callback: (event: import('@tauri-apps/api/webview').DragDropEvent) => void,
      ): () => void
      importDroppedImage(sessionId: string, path: string): Promise<string>
      importImages(sessionId: string, remaining: number): Promise<string[]>
      saveMask(file: string, data: string): Promise<string>
      readImage(file: string): Promise<string>
      exportImages(files: string[]): Promise<boolean>
      retryImageStep(sessionId: string, messageId: string, stepId: string): Promise<StudioData>
      exportImage(file: string): Promise<boolean>
      fetchModels(input: ProviderInput): Promise<ProviderModels>
      testProvider(input: ProviderInput): Promise<boolean>
      onMessage(callback: (message: Message) => void): () => void
    }
  }
}
export {}
