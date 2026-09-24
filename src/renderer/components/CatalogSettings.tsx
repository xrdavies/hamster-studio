import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { CatalogState } from '../../shared/updates'

export default function CatalogSettings({ onApplied }: { onApplied: () => Promise<void> }) {
  const [state, setState] = useState<CatalogState>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    window.studio
      .catalogState()
      .then(setState)
      .catch((error) => setStatus(String(error)))
  }, [])
  const run = async (install: boolean) => {
    setBusy(true)
    setStatus('')
    try {
      const next = install
        ? await window.studio.installCatalog()
        : await window.studio.checkCatalog()
      setState(next)
      setStatus(
        install
          ? '模型能力表已更新'
          : next.availableVersion
            ? '发现新版模型能力表'
            : '模型能力表已是最新',
      )
      if (install) await onApplied()
    } catch (error) {
      setStatus(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="catalog-settings">
      <strong>
        {t('模型能力表')} {state ? `v${state.version}` : ''}
      </strong>
      <p>{t('从 GitHub 检查规则更新，确认后应用；离线使用本地规则。')}</p>
      <button className="secondary" disabled={busy} onClick={() => run(false)}>
        {t(busy ? '检查中…' : '检查规则更新')}
      </button>
      {state?.availableVersion && (
        <button disabled={busy} onClick={() => run(true)}>
          {t('下载并应用')} v{state.availableVersion}
        </button>
      )}
      <p role="status">{t(status)}</p>
    </div>
  )
}
