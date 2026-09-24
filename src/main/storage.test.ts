import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { Store } from './storage'

const files: string[] = []
afterEach(() => {
  for (const file of files.splice(0)) {
    try {
      unlinkSync(file)
    } catch {}
  }
})

describe('Store', () => {
  it('persists providers, sessions and messages without exposing API keys', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const store = new Store(
      file,
      (value) => Buffer.from('encrypted:' + value),
      (value) => value.toString().replace('encrypted:', ''),
    )
    const providerId = store.saveProvider({
      name: 'Relay',
      baseUrl: 'https://example.com/v1',
      chatModels: ['gpt-5.6'],
      imageModels: ['gpt-image-2'],
      apiKey: 'secret',
    })
    const sessionId = store.saveSession({
      providerId,
      chatModel: 'gpt-5.6',
      imageModel: 'gpt-image-2',
      title: '测试',
    })
    store.saveMessage({
      id: randomUUID(),
      sessionId,
      role: 'user',
      kind: 'chat',
      content: '你好',
      imageFiles: [],
      providerName: 'Relay',
      model: 'gpt-5.6',
      createdAt: Date.now(),
      status: 'done',
      error: '',
    })
    expect(store.data().providers[0]).toMatchObject({ name: 'Relay', hasKey: true })
    expect(store.data().providers[0]).not.toHaveProperty('apiKey')
    expect(store.providerKey(providerId)).toBe('secret')
    expect(store.data().sessions[0].title).toBe('测试')
    expect(store.history(sessionId)).toHaveLength(1)
    store.close()
  })

  it('normalizes legacy image model names once', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const store = new Store(
      file,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    )
    store.saveProvider({
      name: 'Relay',
      baseUrl: 'https://example.com/v1',
      chatModels: ['gpt-5.6'],
      imageModels: ['image-2', 'gpt-image-2'],
      apiKey: 'secret',
    })
    expect(store.data().providers[0].imageModels).toEqual(['gpt-image-2', 'gpt-image-2'])
    store.close()
  })

  it('keeps sessions when their provider is deleted', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const store = new Store(
      file,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    )
    const providerId = store.saveProvider({
      name: 'Relay',
      baseUrl: 'https://example.com',
      chatModels: ['gpt-5.6'],
      imageModels: [],
      apiKey: 'secret',
    })
    store.saveSession({ providerId, chatModel: 'gpt-5.6' })
    store.deleteProvider(providerId)
    expect(store.data().sessions).toHaveLength(1)
    const session = store.data().sessions[0]
    expect(() => store.saveSession({ ...session, title: '保留历史' })).not.toThrow()
    store.close()
  })

  it('allows saving and removing all provider models', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const store = new Store(
      file,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    )
    const input = {
      name: 'Relay',
      baseUrl: 'https://example.com',
      chatModels: ['chat'],
      imageModels: ['gpt-image-2'],
      apiKey: 'secret',
    }
    const id = store.saveProvider(input)
    store.saveProvider({ ...input, id, chatModels: [], imageModels: [] })
    expect(store.provider(id)).toMatchObject({ chatModels: [], imageModels: [] })
    store.close()
  })

  it('persists pinned and archived session state', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const store = new Store(
      file,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    )
    const providerId = store.saveProvider({
      name: 'Relay',
      baseUrl: 'https://example.com',
      chatModels: ['gpt-5.6'],
      imageModels: [],
      apiKey: 'secret',
    })
    const sessionId = store.saveSession({
      providerId,
      chatModel: 'gpt-5.6',
      pinned: true,
      archived: true,
    })
    expect(store.data().sessions.find((session) => session.id === sessionId)).toMatchObject({
      pinned: true,
      archived: true,
    })
    store.close()
  })
})
