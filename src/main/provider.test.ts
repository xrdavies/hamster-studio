import { describe, expect, it } from 'vitest'
import { classifyProviderModels, providerUrl } from './provider'

describe('providerUrl', () => {
  it('does not duplicate the v1 path', () => {
    expect(providerUrl('https://relay.example/v1/', '/models')).toBe('https://relay.example/v1/models')
    expect(providerUrl('https://relay.example', '/models')).toBe('https://relay.example/v1/models')
  })
})

describe('classifyProviderModels', () => {
  it('separates chat and image capabilities', () => {
    expect(classifyProviderModels({ data: [{ id: 'gpt-5.6' }, { id: 'gpt-image-2' }, { id: 'custom-image', type: 'image' }] })).toEqual({
      chatModels: ['gpt-5.6'],
      imageModels: ['gpt-image-2', 'custom-image']
    })
  })
})
