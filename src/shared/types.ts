import type { ModelKind } from './model-capabilities'

export type Provider = {
  id: string
  name: string
  baseUrl: string
  chatModels: string[]
  imageModels: string[]
  unknownModels?: string[]
  hasKey: boolean
}

export type ProviderInput = Omit<Provider, 'id' | 'hasKey'> & { id?: string; apiKey?: string }

export type ProviderModels = {
  chatModels: string[]
  imageModels: string[]
  unknownModels?: string[]
}

export type StudioSession = {
  id: string
  title: string
  providerId: string
  modelKind: ModelKind
  chatModel: string
  imageProviderId?: string
  imageModel: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
  archived?: boolean
}

export type ImageStep = {
  sourceImageId?: string

  id: string
  prompt: string
  count: number
  status: 'waiting' | 'running' | 'done' | 'error'
  needsConfiguration: boolean
  operation: 'generate' | 'edit'
  imageFiles: string[]
  error: string
  model?: string
  providerName?: string
}

export type Message = {
  viewedImageIds?: string[]

  agent?: boolean
  referenceFile?: string
  steps?: ImageStep[]
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  kind: 'chat' | 'image'
  content: string
  imageFiles: string[]
  providerName: string
  model: string
  createdAt: number
  status: 'done' | 'streaming' | 'error'
  error: string
}

export type StudioData = {
  providers: Provider[]
  sessions: StudioSession[]
  messages: Message[]
}

export type StreamEvent = { requestId: string; message: Message; done: boolean }
