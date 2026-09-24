import { useSyncExternalStore } from 'react'
import en from '../shared/locales/en.json'
import zh from '../shared/locales/zh.json'

export type Language = 'zh' | 'en'
const saved = localStorage.getItem('studio.language')
let language: Language =
  saved === 'zh' || saved === 'en' ? saved : navigator.language.startsWith('zh') ? 'zh' : 'en'
const listeners = new Set<() => void>()
export function t(key: string): string {
  const dictionary: Record<string, string> = language === 'en' ? en : zh
  const source = Object.keys(en).find((source) => en[source as keyof typeof en] === key) ?? key
  return dictionary[source] ?? key
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
