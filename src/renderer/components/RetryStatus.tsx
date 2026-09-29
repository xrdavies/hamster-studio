import { useEffect, useState } from 'react'
import type { Message } from '../../shared/types'
import { t } from '../i18n'

export default function RetryStatus({ message }: { message?: Message }) {
  const [now, setNow] = useState(Date.now())
  const active = message?.status === 'streaming' && !!message.retryAttempt
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, message?.retryAt])
  if (!active || !message) return null
  const seconds = Math.max(0, Math.ceil(((message.retryAt || 0) - now) / 1000))
  return (
    <span className="retry-status" role="status">
      {t(seconds ? 'retry.wait' : message.retryKind === 'image' ? 'retry.image' : 'retry.running', {
        attempt: message.retryAttempt!,
        seconds,
      })}
    </span>
  )
}
