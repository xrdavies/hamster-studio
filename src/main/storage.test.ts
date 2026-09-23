import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { Store } from './storage'

const files: string[] = []
afterEach(() => { for (const file of files.splice(0)) { try { unlinkSync(file) } catch {} } })

describe('Store', () => {
  it('persists providers, sessions and messages without exposing API keys', () => {
    const file = '/tmp/hamster-studio-' + randomUUID() + '.db'; files.push(file)
    const store = new Store(file, value => Buffer.from('encrypted:' + value), value => value.toString().replace('encrypted:', ''))
    const providerId = store.saveProvider({ name: 'Relay', baseUrl: 'https://example.com/v1', chatModels: ['gpt-5.6'], imageModels: ['image2'], apiKey: 'secret' })
    const sessionId = store.saveSession({ providerId, chatModel: 'gpt-5.6', imageModel: 'image2', title: '测试' })
    store.saveMessage({ id: randomUUID(), sessionId, role: 'user', kind: 'chat', content: '你好', imageFiles: [], providerName: 'Relay', model: 'gpt-5.6', createdAt: Date.now(), status: 'done', error: '' })
    expect(store.data().providers[0]).toMatchObject({ name: 'Relay', hasKey: true })
    expect(store.data().providers[0]).not.toHaveProperty('apiKey')
    expect(store.providerKey(providerId)).toBe('secret')
    expect(store.data().sessions[0].title).toBe('测试')
    expect(store.history(sessionId)).toHaveLength(1)
    store.close()
  })
})
