import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import { logEntries } from './logEntries'

export default function DiagnosticLogs({
  requestId,
  askConfirm,
}: {
  requestId?: string
  askConfirm: (title: string, message: string, action: () => void) => void
}) {
  const [text, setText] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(true)
  const entries = useMemo(() => logEntries(text), [text])
  const visible = errorsOnly ? entries.filter((entry) => entry.error) : entries
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const view = useRef<HTMLDivElement>(null)
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
      <div className="log-header">
        <h3>{t('logs.title')}</h3>
        <div className="log-actions">
          <select
            aria-label={t('logs.filter')}
            value={errorsOnly ? 'errors' : 'all'}
            onChange={(event) => setErrorsOnly(event.target.value === 'errors')}
          >
            <option value="errors">{t('logs.errorsOnly')}</option>
            <option value="all">{t('logs.all')}</option>
          </select>
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
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="log-output" ref={view} tabIndex={0} aria-label={t('logs.title')}>
        {visible.length
          ? visible.map((entry, index) =>
              entry.error ? (
                <details key={index}>
                  <summary>{entry.raw}</summary>
                  <pre>{entry.related || entry.raw}</pre>
                </details>
              ) : (
                <pre key={index}>{entry.raw}</pre>
              ),
            )
          : t(errorsOnly ? 'logs.noErrors' : requestId ? 'logs.expired' : 'logs.empty')}
      </div>
    </section>
  )
}
