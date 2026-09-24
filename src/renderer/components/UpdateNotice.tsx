import { useEffect, useState } from 'react'
import { t, useLanguage } from '../i18n'
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
    idle: '尚未检查更新',
    disabled: '开发版本不支持自动更新，请使用安装版检查更新。',
    checking: '检查中…',
    current: '当前已是最新版本',
    available: '发现新版本',
    downloading: '正在下载更新',
    downloaded: '更新已下载',
    error: '检查更新失败',
  }
  return (
    <div className={manual ? 'about-update' : 'update-notice'} role="status">
      <p>
        {t(labels[state.status])} {state.version || ''}{' '}
        {state.status === 'downloading' ? `${state.percent || 0}%` : ''}
      </p>
      {state.status === 'error' && <p className="form-error">{state.error}</p>}
      {error && <p className="form-error">{t(error)}</p>}
      {manual && (
        <button
          className="secondary"
          disabled={['checking', 'downloading', 'downloaded'].includes(state.status)}
          onClick={() => action(() => window.studio.checkUpdates())}
        >
          {t('检查更新')}
        </button>
      )}
      {state.status === 'available' && (
        <button onClick={() => action(() => window.studio.downloadUpdate())}>
          {t('下载更新')}
        </button>
      )}
      {state.status === 'downloaded' && (
        <button onClick={() => setConfirm(true)}>{t('重启并安装')}</button>
      )}
      {!manual && (
        <button className="secondary" onClick={() => setDismissed(key)}>
          {t('稍后')}
        </button>
      )}
      {confirm && (
        <ConfirmDialog
          state={{
            title: t('重启并安装'),
            message: t('应用将退出并安装更新。请先保存设置；未发送的草稿会丢失。'),
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
