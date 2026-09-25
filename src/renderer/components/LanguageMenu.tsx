import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { setLanguage, t, useLanguage } from '../i18n'

const languages = [
  { value: 'zh', label: 'ui.simplifiedChinese' },
  { value: 'en', label: 'English' },
] as const

export default function LanguageMenu() {
  const language = useLanguage()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return (
    <div
      className="model-menu language-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) {
            setOpen(true)
            return
          }
          const options = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
          )
          const current = options.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? options.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[next]?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="model-trigger"
        aria-label={t('ui.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>{languages.find((item) => item.value === language)?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="model-menu-panel" role="menu" aria-label={t('ui.language')}>
          {languages.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={language === item.value}
              className="model-option"
              tabIndex={-1}
              onClick={() => {
                setLanguage(item.value)
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              <span>{item.label}</span>
              {language === item.value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
