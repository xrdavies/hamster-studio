export type Skill = {
  schemaVersion?: number
  requirements?: { minImages: number; maxImages: number; capabilities: string[] }
  id: string
  version: number
  name: string
  description: string
  tools: string[]
  instructions: string
}

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
  skill?: Skill | null
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
  repeated?: boolean
  dispatchState?: 'not_sent' | 'unknown' | 'received'

  sourceImageId?: string
  sourceImageIds?: string[]

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
  skill?: Skill
  skillWarnings?: string[]
  skillDraft?: Skill
  canContinue?: boolean
  retryAttempt?: number
  retryDelay?: number

  webStatus?: 'reading' | 'done' | 'error'
  webError?: string

  errorDetail?: string

  viewedImageIds?: string[]

  agent?: boolean
  maskFile?: string
  referenceFile?: string
  referenceFiles?: string[]
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
