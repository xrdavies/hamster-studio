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
      <div className="catalog-settings-row">
        <details className="catalog-details">
          <summary>
            {t('ui.modelCapabilities')} {state ? `v${state.version}` : ''}
          </summary>
          <p>{t('ui.checkGitHubForRuleUpdatesAndApplyAfterConfirmationLocalRulesWorkOffline')}</p>
        </details>
        <div className="catalog-actions">
          <button className="secondary" disabled={busy} onClick={() => run(false)}>
            {t(busy ? 'ui.checking' : 'ui.checkRuleUpdates')}
          </button>
          {state?.availableVersion && (
            <button className="secondary" disabled={busy} onClick={() => run(true)}>
              {t('ui.downloadAndApply')} v{state.availableVersion}
            </button>
          )}
        </div>
      </div>
      {status && (
        <p className="catalog-status" role="status">
          {translateMessage(status)}
        </p>
      )}
    </div>
  )
}
