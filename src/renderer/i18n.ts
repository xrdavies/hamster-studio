import { useSyncExternalStore } from 'react'
import en from '../shared/locales/en.json'
import zh from '../shared/locales/zh.json'

export type Language = 'zh' | 'en'
const saved = localStorage.getItem('studio.language')
let language: Language =
  saved === 'zh' || saved === 'en' ? saved : navigator.language.startsWith('zh') ? 'zh' : 'en'
const listeners = new Set<() => void>()
export type TranslationKey = keyof typeof en
export function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
  const dictionary = language === 'en' ? en : zh
  return dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(params[name] ?? match),
  )
}
// Provider errors and user-authored content must never be reverse-translated.
export function translateMessage(message: string): string {
  return Object.hasOwn(en, message) ? t(message as TranslationKey) : message
}
export function setLanguage(next: Language) {
  localStorage.setItem('studio.language', next)
  language = next
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  listeners.forEach((listener) => listener())
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => language,
  )
}
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
