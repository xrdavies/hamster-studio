import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

export default function DiagnosticLogs({
  requestId,
  askConfirm,
}: {
  requestId?: string
  askConfirm: (title: string, message: string, action: () => void) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const view = useRef<HTMLPreElement>(null)
  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      setText(await window.studio.readLogs(requestId))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [requestId])
  useEffect(() => {
    if (view.current) view.current.scrollTop = view.current.scrollHeight
  }, [text])
  return (
    <section className="diagnostic-logs">
      <h3>{t('logs.title')}</h3>
      <p>{t('logs.privacy')}</p>
      <div className="log-actions">
        <button className="secondary" disabled={busy} onClick={() => void refresh()}>
          {t('logs.refresh')}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await window.studio.exportLogs()
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('logs.export')}
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() =>
            askConfirm(t('logs.clear'), t('logs.clearHelp'), () => {
              void window.studio
                .clearLogs()
                .then(refresh)
                .catch((e) => setError(String(e)))
            })
          }
        >
          {t('logs.clear')}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <pre ref={view} tabIndex={0} aria-label={t('logs.title')}>
        {text || t(requestId ? 'logs.expired' : 'logs.empty')}
      </pre>
    </section>
  )
}
