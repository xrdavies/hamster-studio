import { expect, it, vi } from 'vitest'
vi.mock('../i18n', () => ({ t: (key: string) => key }))
import { maskPixels } from './RegionEditor'
it('exports painted pixels as transparent and untouched pixels as opaque', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 0, 136, 100, 237, 255, 136, 100, 237, 1])
  maskPixels(pixels)
  expect([...pixels]).toEqual([255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 0])
})
