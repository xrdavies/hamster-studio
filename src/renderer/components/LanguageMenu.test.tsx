import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const state = vi.hoisted(() => ({ language: 'zh' }))
vi.mock('../i18n', () => ({
  useLanguage: () => state.language,
  setLanguage: vi.fn(),
  t: () => 'Language',
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [true, vi.fn()],
}))
import LanguageMenu from './LanguageMenu'
it('shows native language names in the trigger and open menu in both languages', () => {
  for (const language of ['zh', 'en']) {
    state.language = language
    const html = renderToStaticMarkup(<LanguageMenu />)
    expect(html).toContain('简体中文')
    expect(html).toContain('English')
    expect(html).not.toContain('ui.')
    expect(html.split(language === 'zh' ? '简体中文' : 'English')).toHaveLength(3)
  }
})
