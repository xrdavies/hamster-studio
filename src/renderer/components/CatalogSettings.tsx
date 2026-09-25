import { useEffect, useState } from 'react'
import { translateMessage, t } from '../i18n'
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
          ? 'ui.modelCapabilitiesUpdated'
          : next.availableVersion
            ? 'ui.newModelCapabilitiesAvailable'
            : 'ui.modelCapabilitiesAreUpToDate',
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
        {t('ui.modelCapabilities')} {state ? `v${state.version}` : ''}
      </strong>
      <p>{t('ui.checkGitHubForRuleUpdatesAndApplyAfterConfirmationLocalRulesWorkOffline')}</p>
      <button className="secondary" disabled={busy} onClick={() => run(false)}>
        {t(busy ? 'ui.checking' : 'ui.checkRuleUpdates')}
      </button>
      {state?.availableVersion && (
        <button disabled={busy} onClick={() => run(true)}>
          {t('ui.downloadAndApply')} v{state.availableVersion}
        </button>
      )}
      <p role="status">{translateMessage(status)}</p>
    </div>
  )
}
