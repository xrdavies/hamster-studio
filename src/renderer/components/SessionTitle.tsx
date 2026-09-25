import { t } from '../i18n'
import { useEffect, useRef } from 'react'

export default function SessionTitle({
  title,
  onSave,
}: {
  title: string
  onSave: (title: string) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const pendingBlur = useRef(false)
  useEffect(() => {
    if (input.current && document.activeElement !== input.current && !composing.current)
      input.current.value = title
  }, [title])
  const commit = () => {
    if (composing.current) {
      pendingBlur.current = true
      return
    }
    const element = input.current
    if (!element) return
    const next = element.value.trim() || title
    element.value = next
    pendingBlur.current = false
    if (next !== title) void onSave(next)
  }
  return (
    <input
      ref={input}
      className="title-input"
      aria-label={t('ui.conversationTitle')}
      defaultValue={title}
      onFocus={() => {
        pendingBlur.current = false
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
        // Let the browser apply the final IME input before saving a blurred field.
        queueMicrotask(() => {
          if (pendingBlur.current) commit()
        })
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}
