import { useEffect, useState } from 'react'
import { translateMessage, t, useLanguage } from '../i18n'
import type { UpdateState } from '../../shared/updates'
import ConfirmDialog from './ConfirmDialog'

export default function UpdateNotice({ manual = false }: { manual?: boolean }) {
  useLanguage()
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let received = false
    const off = window.studio.onUpdate((next) => {
      received = true
      setState(next)
    })
    window.studio
      .updateState()
      .then((next) => {
        if (!received) setState(next)
      })
      .catch(() => {})
    return off
  }, [])
  const action = async (run: () => Promise<unknown>) => {
    setError('')
    try {
      await run()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(error),
      )
    }
  }
  const key = `${state.status}:${state.version}`
  if (
    !manual &&
    (dismissed === key || !['available', 'downloading', 'downloaded'].includes(state.status))
  )
    return null
  const labels = {
    idle: 'ui.updatesNotCheckedYet',
    disabled: 'ui.automaticUpdatesAreUnavailableInDevelopmentBuildsUseAnInstalledRelease',
    checking: 'ui.checking',
    current: 'ui.youAreUpToDate',
    available: 'ui.newVersionAvailable',
    downloading: 'ui.downloadingUpdate',
    downloaded: 'ui.updateDownloaded',
    error: 'ui.failedToCheckForUpdates',
  } as const
  return (
    <div className={manual ? 'about-update' : 'update-notice'} role="status">
      <p>
        {t(labels[state.status])} {state.version || ''}{' '}
        {state.status === 'downloading' ? `${state.percent || 0}%` : ''}
      </p>
      {state.status === 'error' && <p className="form-error">{state.error}</p>}
      {error && <p className="form-error">{translateMessage(error)}</p>}
      {manual && (
        <button
          className="secondary"
          disabled={['checking', 'downloading', 'downloaded'].includes(state.status)}
          onClick={() => action(() => window.studio.checkUpdates())}
        >
          {t('ui.checkForUpdates')}
        </button>
      )}
      {state.status === 'available' && (
        <button onClick={() => action(() => window.studio.downloadUpdate())}>
          {t('ui.downloadUpdate')}
        </button>
      )}
      {state.status === 'downloaded' && (
        <button onClick={() => setConfirm(true)}>{t('ui.restartAndInstall')}</button>
      )}
      {!manual && (
        <button className="secondary" onClick={() => setDismissed(key)}>
          {t('ui.later')}
        </button>
      )}
      {confirm && (
        <ConfirmDialog
          state={{
            title: t('ui.restartAndInstall'),
            message: t(
              'ui.theAppWillCloseToInstallTheUpdateSaveYourSettingsFirstUnsentDraftsWillBeLost',
            ),
            confirm: () => {
              setConfirm(false)
              void action(() => window.studio.installUpdate())
            },
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
