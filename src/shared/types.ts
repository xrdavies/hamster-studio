export type Skill = {
  schemaVersion?: number
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
  operation: 'generate' | 'edit' | 'psd_edit' | 'exact_edit'
  documentId?: string
  resultDocumentId?: string
  warnings?: string[]
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
  retryAt?: number
  retryKind?: string
  retryAttempt?: number
  retryDelay?: number

  webStatus?: 'reading' | 'done' | 'error'
  webError?: string

  errorDetail?: string

  viewedImageIds?: string[]

  agent?: boolean
  maskFile?: string
  markerFile?: string
  markerPrompt?: string
  referenceFile?: string
  referenceFiles?: string[]
  documentIds?: string[]
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

export type PsdDocument = {
  id: string
  sessionId: string
  name: string
  version: number
  parentId?: string | null
  originId: string
  previewImageId: string
  width: number
  height: number
  layerCount: number
  warnings?: string[]
  canReplaceOriginal: boolean
  createdAt: number
}

export type StudioData = {
  providers: Provider[]
  sessions: StudioSession[]
  messages: Message[]
  documents?: PsdDocument[]
}

export type StreamEvent = { requestId: string; message: Message; done: boolean }
