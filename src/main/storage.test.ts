import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { Store } from './storage'
import Database from 'better-sqlite3'

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

  it('keeps each session model selection independent across saves and restarts', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const open = () =>
      new Store(
        file,
        (value) => Buffer.from(value),
        (value) => value.toString(),
      )
    let store = open()
    try {
      const providerId = store.saveProvider({
        name: 'Relay',
        baseUrl: 'https://example.com',
        chatModels: ['chat-a', 'chat-b'],
        imageModels: ['image-a', 'image-b'],
      })
      const otherProviderId = store.saveProvider({
        name: 'Other',
        baseUrl: 'https://other.example.com',
        chatModels: ['other-chat'],
        imageModels: ['other-image'],
      })
      const a = store.saveSession({
        providerId,
        chatModel: 'chat-b',
        imageModel: 'image-b',
        modelKind: 'image',
      })
      const b = store.saveSession({ providerId, chatModel: 'chat-a', modelKind: 'chat' })
      const originalA = store.session(a)
      store.saveSession({
        ...store.session(b),
        providerId: otherProviderId,
        chatModel: 'other-chat',
        modelKind: 'chat',
      })
      expect(store.session(a)).toEqual(originalA)
      store.saveSession({ ...store.session(b), imageModel: 'other-image', modelKind: 'image' })
      store.saveSession({ ...store.session(a), modelKind: 'chat' })
      // A metadata-only save must not reset the selected model type.
      store.saveSession({
        ...store.session(b),
        modelKind: undefined,
        title: 'Renamed',
        pinned: true,
      })
      store.close()
      store = open()
      expect(store.data().sessions.find((session) => session.id === a)).toMatchObject({
        providerId,
        modelKind: 'chat',
        chatModel: 'chat-b',
        imageModel: 'image-b',
      })
      expect(store.data().sessions.find((session) => session.id === b)).toMatchObject({
        providerId: otherProviderId,
        modelKind: 'image',
        imageModel: 'other-image',
        title: 'Renamed',
        pinned: true,
      })
    } finally {
      store.close()
    }
  })

  it('migrates legacy sessions using their latest message only once', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'
    files.push(file)
    const legacy = new Database(file)
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, providerId TEXT NOT NULL,
        chatModel TEXT NOT NULL, imageModel TEXT NOT NULL, systemPrompt TEXT NOT NULL,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, imageFiles TEXT NOT NULL,
        providerName TEXT NOT NULL, model TEXT NOT NULL, createdAt INTEGER NOT NULL,
        status TEXT NOT NULL, error TEXT NOT NULL
      );
      INSERT INTO sessions VALUES ('a', 'A', 'deleted-provider', 'chat', 'image', '', 1, 1);
      INSERT INTO sessions VALUES ('b', 'B', 'deleted-provider', 'chat', 'image', '', 1, 1);
      INSERT INTO messages VALUES ('m1', 'a', 'user', 'chat', 'hello', '[]', 'Relay', 'chat', 1, 'done', '');
      INSERT INTO messages VALUES ('m2', 'a', 'user', 'image', 'draw', '[]', 'Relay', 'image', 2, 'done', '');
    `)
    legacy.close()
    const open = () =>
      new Store(
        file,
        (value) => Buffer.from(value),
        (value) => value.toString(),
      )
    let store = open()
    try {
      expect(store.session('a').modelKind).toBe('image')
      expect(store.session('b').modelKind).toBe('chat')
      expect(store.data().messages).toHaveLength(2)
      store.saveSession({ ...store.session('a'), modelKind: 'chat' })
      store.close()
      store = open()
      expect(store.session('a').modelKind).toBe('chat')
    } finally {
      store.close()
    }
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
