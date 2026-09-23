export type Provider = {
  id: string
  name: string
  baseUrl: string
  chatModels: string[]
  imageModels: string[]
  hasKey: boolean
}

export type ProviderInput = Omit<Provider, 'id' | 'hasKey'> & { id?: string; apiKey?: string }

export type StudioSession = {
  id: string
  title: string
  providerId: string
  chatModel: string
  imageModel: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
}

export type Message = {
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
