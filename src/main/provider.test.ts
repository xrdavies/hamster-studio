import { describe, expect, it } from 'vitest'
import { providerUrl } from './provider'

describe('providerUrl', () => {
  it('does not duplicate the v1 path', () => {
    expect(providerUrl('https://relay.example/v1/', '/models')).toBe('https://relay.example/v1/models')
    expect(providerUrl('https://relay.example', '/models')).toBe('https://relay.example/v1/models')
  })
})
