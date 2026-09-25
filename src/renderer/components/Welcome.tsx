import { t } from '../i18n'
import type { Provider } from '../../shared/types'
import hamsterLogo from '../assets/hamster-logo-256.png'

export function EmptyState({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="empty">
      <img src={hamsterLogo} className="welcome-logo" alt="Hamster Studio" />
      <h1>{t('ui.getStartedWithHamsterStudio')}</h1>
      <p>{t('ui.configureAnOpenAICompatibleProviderToChatOrGenerateImages')}</p>
      <button onClick={onSettings}>{t('ui.configureProvider')}</button>
    </div>
  )
}
export function Welcome({
  provider,
  onPrompt,
}: {
  provider?: Provider
  onPrompt: (prompt: string) => void
}) {
  const suggestions = [
    t('ui.helpMeCreateAThreeStepPlan'),
    t('ui.writeAConciseProductIntroduction'),
    t('ui.generateAMinimalistPoster'),
  ]
  return (
    <div className="welcome">
      <img src={hamsterLogo} className="welcome-logo" alt="Hamster Studio" />
      <h2>{t('ui.howCanIHelpYou')}</h2>
      <p>
        {provider
          ? t('ui.using') + provider.name + t('ui.yourAPIKeyIsStoredOnlyOnThisDevice')
          : t('ui.configureAProviderFirst')}
      </p>
      <div className="suggestions">
        {suggestions.map((item) => (
          <button key={item} onClick={() => onPrompt(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  )
}
