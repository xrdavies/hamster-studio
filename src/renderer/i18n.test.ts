import { expect, it, vi } from 'vitest'
import en from '../shared/locales/en.json'
import zh from '../shared/locales/zh.json'

it('switches language, persists preference, and preserves unknown content', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  vi.stubGlobal('document', { documentElement: { lang: '' } })
  const { t, setLanguage } = await import('./i18n')
  expect(Object.keys(en)).toEqual(Object.keys(zh))
  expect(t('设置')).toBe('设置')
  setLanguage('en')
  expect(t('设置')).toBe('Settings')
  expect(storage.get('studio.language')).toBe('en')
  expect(document.documentElement.lang).toBe('en')
  expect(t('Provider returned an unknown error')).toBe('Provider returned an unknown error')
  setLanguage('zh')
  expect(t('Settings')).toBe('设置')
  vi.unstubAllGlobals()
})
