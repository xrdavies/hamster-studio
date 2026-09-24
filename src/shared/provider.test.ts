import { describe, expect, it } from 'vitest'
import { classifyProviderModels, providerUrl } from './provider'

describe('providerUrl', () => {
  it('does not duplicate the v1 path', () => {
    expect(providerUrl('https://relay.example/v1/', '/models')).toBe(
      'https://relay.example/v1/models',
    )
    expect(providerUrl('https://relay.example', '/models')).toBe('https://relay.example/v1/models')
  })
})

describe('classifyProviderModels', () => {
  it('separates chat and image capabilities', () => {
    expect(
      classifyProviderModels({
        data: [{ id: 'gpt-5.6' }, { id: 'gpt-image-2' }, { id: 'custom-image', type: 'image' }],
      }),
    ).toEqual({
      chatModels: ['gpt-5.6'],
      imageModels: ['gpt-image-2', 'custom-image'],
      unknownModels: [],
    })
  })
})

import { classifyModels } from './model-capabilities'

it('classifies manual model IDs and removes whitespace and duplicates', () => {
  expect(classifyModels([' gpt-image-2 ', 'gpt-5.6', '', 'gpt-image-2'])).toEqual({
    chatModels: ['gpt-5.6'],
    imageModels: ['gpt-image-2'],
    unknownModels: [],
  })
})

import { aboutUrl } from './about'
it('opens only configured About links', () => {
  expect(aboutUrl('author')).toBe('https://x.com/xrdavies')
  expect(() => aboutUrl('https://untrusted.example')).toThrow()
  expect(() => aboutUrl('__proto__')).toThrow()
})

it('defaults unlisted models to chat and gives image rules priority over chat hints', () => {
  expect(classifyModels(['custom-model', 'image-reader', 'gpt-image-future'])).toEqual({
    chatModels: ['custom-model', 'image-reader'],
    imageModels: ['gpt-image-future'],
    unknownModels: [],
  })
  expect(
    classifyProviderModels({
      data: [{ id: 'gpt-image-future', type: 'chat' }, { id: 'custom-model' }],
    }),
  ).toEqual({
    chatModels: ['custom-model'],
    imageModels: ['gpt-image-future'],
    unknownModels: [],
  })
})
