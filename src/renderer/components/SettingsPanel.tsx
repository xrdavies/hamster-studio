import { translateMessage, t } from '../i18n'
import LanguageMenu from './LanguageMenu'
import { useEffect, useState } from 'react'
import {
  Globe,
  Image as ImageIcon,
  Info,
  Languages,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import type { ProviderInput, StudioData } from '../../shared/types'
import UpdateNotice from './UpdateNotice'
import CatalogSettings from './CatalogSettings'
import { aboutLinks } from '../../shared/about'
import hamsterLogo from '../assets/hamster-logo-256.png'

export type EditingProvider = ProviderInput & {
  loading: boolean
  fetchError: string
  testResult: string
}

export const emptyProvider: ProviderInput = {
  name: '',
  baseUrl: '',
  chatModels: [],
  imageModels: [],
  unknownModels: [],
}
const unique = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
]
export function makeEditing(input: ProviderInput): EditingProvider {
  return {
    ...input,
    loading: false,
    fetchError: '',
    testResult: '',
  }
}
export default function SettingsPanel({
  data,
  page,
  setPage,
  editing,
  setEditing,
  close,
  refresh,
  askConfirm,
}: {
  data: StudioData
  page: 'general' | 'providers' | 'about'
  setPage: (page: 'general' | 'providers' | 'about') => void
  editing: EditingProvider | null
  setEditing: (value: EditingProvider | null) => void
  close: () => void
  refresh: (data: StudioData) => void
  askConfirm: (title: string, message: string, action: () => void) => void
}) {
  const current = editing
  const [manualModel, setManualModel] = useState('')
  const [linkError, setLinkError] = useState('')
  const openLink = async (key: keyof typeof aboutLinks) => {
    setLinkError('')
    try {
      await window.studio.openAboutLink(key)
    } catch {
      setLinkError(t('ui.unableToOpenBrowserPleaseTryAgain'))
    }
  }
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.studio
      .version()
      .then(setVersion)
      .catch(() => setVersion(t('ui.unknown')))
  }, [])
  const fetchModels = async () => {
    if (!current) return
    setEditing({ ...current, loading: true, fetchError: '', testResult: '' })
    try {
      const fetched = await window.studio.fetchModels(current)
      const fetchedIds = new Set([
        ...fetched.chatModels,
        ...fetched.imageModels,
        ...(fetched.unknownModels || []),
      ])
      setEditing({
        ...current,
        chatModels: unique([
          ...current.chatModels.filter((id) => !fetchedIds.has(id)),
          ...fetched.chatModels,
        ]),
        imageModels: unique([
          ...current.imageModels.filter((id) => !fetchedIds.has(id)),
          ...fetched.imageModels,
        ]),
        unknownModels: unique([
          ...(current.unknownModels || []).filter((id) => !fetchedIds.has(id)),
          ...(fetched.unknownModels || []),
        ]),
        loading: false,
        fetchError: '',
        testResult: t('ui.modelListUpdated'),
      })
    } catch (reason) {
      setEditing({
        ...current,
        loading: false,
        fetchError: reason instanceof Error ? reason.message : t('ui.failedToFetchModels'),
      })
    }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!current) return
    try {
      await window.studio.saveProvider({
        ...current,
        chatModels: unique(current.chatModels),
        imageModels: unique(current.imageModels),
      })
      refresh(await window.studio.load())
      setEditing(null)
    } catch (reason) {
      setEditing({
        ...current,
        fetchError: reason instanceof Error ? reason.message : t('ui.failedToSave'),
      })
    }
  }
  const test = async () => {
    if (!current) return
    try {
      await window.studio.testProvider(current)
      setEditing({ ...current, testResult: t('ui.connectionSuccessful'), fetchError: '' })
    } catch (reason) {
      setEditing({
        ...current,
        testResult: '',
        fetchError: reason instanceof Error ? reason.message : t('ui.connectionFailed'),
      })
    }
  }
  const remove = () => {
    if (!current?.id) return
    askConfirm(
      t('ui.deleteProvider'),
      t('ui.conversationsAndMessagesWillBePreservedSelectAnotherProviderToContinue'),
      async () => {
        await window.studio.deleteProvider(current.id!)
        refresh(await window.studio.load())
        setEditing(null)
      },
    )
  }
  const providerEditor = current && (
    <>
      <div className="settings-head">
        <h2>{current.id ? t('ui.editProvider') : t('ui.addProvider')}</h2>
        <button onClick={() => setEditing(null)}>
          <X />
        </button>
      </div>
      <form onSubmit={save}>
        <fieldset className="provider-form" disabled={current.loading}>
          <label>
            {t('ui.name')}
            <input
              required
              value={current.name}
              onChange={(event) => setEditing({ ...current, name: event.target.value })}
              placeholder={t('ui.myProvider')}
            />
          </label>
          <label>
            Base URL
            <input
              required
              type="url"
              value={current.baseUrl}
              onChange={(event) => setEditing({ ...current, baseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={current.apiKey || ''}
              onChange={(event) => setEditing({ ...current, apiKey: event.target.value })}
              placeholder={current.id ? t('ui.leaveBlankToKeepTheExistingKey') : 'sk-…'}
            />
          </label>
          <div className="model-fetch-row">
            <span>{t('ui.models')}</span>
            <button
              type="button"
              className="secondary"
              disabled={
                !current.chatModels.length &&
                !current.imageModels.length &&
                !current.unknownModels?.length
              }
              onClick={() =>
                setEditing({
                  ...current,
                  chatModels: [],
                  imageModels: [],
                  unknownModels: [],
                  fetchError: '',
                  testResult: t('ui.modelListClearedSaveToApplyChanges'),
                })
              }
            >
              {t('ui.clearModels')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={fetchModels}
              disabled={current.loading}
            >
              {current.loading ? t('ui.fetching') : t('ui.fetchProviderModels')}
            </button>
          </div>
          {current.fetchError && (
            <div className="form-error">{translateMessage(current.fetchError)}</div>
          )}
          {current.testResult && (
            <div className="form-success">{translateMessage(current.testResult)}</div>
          )}
          <label>
            {t('ui.addModelsManually')}
            <input
              value={manualModel}
              onChange={(event) => setManualModel(event.target.value)}
              placeholder={t('ui.enterModelIDsSeparatedByCommas')}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!manualModel.trim()}
            onClick={async () => {
              try {
                const extra = await window.studio.classifyModels(
                  manualModel
                    .split(',')
                    .map((id) => id.trim())
                    .filter(
                      (id) =>
                        ![
                          ...current.chatModels,
                          ...current.imageModels,
                          ...(current.unknownModels || []),
                        ].includes(id),
                    ),
                )
                setEditing({
                  ...current,
                  chatModels: unique([...current.chatModels, ...extra.chatModels]),
                  imageModels: unique([...current.imageModels, ...extra.imageModels]),
                  unknownModels: unique([
                    ...(current.unknownModels || []),
                    ...(extra.unknownModels || []),
                  ]),
                })
                setManualModel('')
              } catch (error) {
                setEditing({ ...current, fetchError: String(error) })
              }
            }}
          >
            {t('ui.addToModelList')}
          </button>
          <div className="capability-chips edit">
            {unique([
              ...current.chatModels,
              ...current.imageModels,
              ...(current.unknownModels || []),
            ]).map((model) => (
              <span key={model}>
                {model}
                <button
                  type="button"
                  className="remove-model"
                  aria-label={`${t('ui.delete')} ${model}`}
                  title={`${t('ui.delete')} ${model}`}
                  onClick={() =>
                    setEditing({
                      ...current,
                      chatModels: current.chatModels.filter((item) => item !== model),
                      imageModels: current.imageModels.filter((item) => item !== model),
                      unknownModels: current.unknownModels?.filter((item) => item !== model),
                      testResult: '',
                    })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={test}>
              {t('ui.testConnection')}
            </button>
            <button type="submit">{t('ui.saveProvider')}</button>
          </div>
        </fieldset>
      </form>
      {current.id && (
        <button className="danger-link" onClick={remove}>
          <Trash2 size={14} />
          {t('ui.deleteProvider')}
        </button>
      )}
    </>
  )
  const providerList = (
    <>
      <div className="settings-title">
        <div>
          <h3>{t('settings.providers')}</h3>
          <p>{t('ui.fetchModelsOnDemandOrAddAndRemoveThemManuallySaveToApplyChanges')}</p>
        </div>
        <button onClick={() => setEditing(makeEditing(emptyProvider))}>
          <Plus size={16} />
          {t('ui.add')}
        </button>
      </div>
      {data.providers.length === 0 && (
        <div className="settings-empty">{t('ui.noProvidersYet')}</div>
      )}
      {data.providers.map((item) => (
        <div className="provider-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <small>
              {item.baseUrl} · {item.hasKey ? t('ui.keyConfigured') : t('ui.noKeyConfigured')}
            </small>
            <div className="capability-chips">
              {item.unknownModels?.map((model) => (
                <span key={model} title={t('ui.unknownCapabilityUnavailableForGeneration')}>
                  ? {model}
                </span>
              ))}
              {item.chatModels.map((model) => (
                <span key={model}>
                  <MessageSquare size={11} />
                  {model}
                </span>
              ))}
              {item.imageModels.map((model) => (
                <span key={model}>
                  <ImageIcon size={11} />
                  {model}
                </span>
              ))}
            </div>
          </div>
          <button onClick={() => setEditing(makeEditing(item))}>{t('ui.edit')}</button>
        </div>
      ))}
    </>
  )
  const content = current ? (
    providerEditor
  ) : (
    <>
      <div className="settings-head">
        <h2>{t('ui.settings')}</h2>
        <button onClick={close}>
          <X />
        </button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button
            aria-current={page === 'general' ? 'page' : undefined}
            className={page === 'general' ? 'active' : ''}
            onClick={() => setPage('general')}
          >
            <Languages size={16} />
            {t('ui.general')}
          </button>
          <button
            aria-current={page === 'providers' ? 'page' : undefined}
            className={page === 'providers' ? 'active' : ''}
            onClick={() => setPage('providers')}
          >
            <Globe size={16} />
            {t('settings.providers')}
          </button>
          <button
            aria-current={page === 'about' ? 'page' : undefined}
            className={page === 'about' ? 'active' : ''}
            onClick={() => setPage('about')}
          >
            <Info size={16} />
            {t('settings.about')}
          </button>
        </nav>
        <div className="settings-content">
          {page === 'general' && (
            <>
              <div className="settings-title">
                <div>
                  <h3>{t('ui.generalSettings')}</h3>
                  <p>{t('ui.localPreferencesForHamsterStudio')}</p>
                </div>
              </div>
              <div className="setting-item">
                <span>{t('ui.language')}</span>
                <LanguageMenu />
              </div>
              <CatalogSettings
                onApplied={async () => {
                  refresh(await window.studio.load())
                }}
              />
              <div className="setting-item">
                <span>{t('ui.dataStorage')}</span>
                <strong>{t('ui.storedOnThisDeviceOnly')}</strong>
              </div>
            </>
          )}
          {page === 'providers' && providerList}
          {page === 'about' && (
            <section className="about-page" aria-label={t('ui.aboutHamsterStudio')}>
              <img className="about-logo" src={hamsterLogo} alt="Hamster Studio Logo" />
              <h2>Hamster Studio</h2>
              <span className="about-version">
                {t('ui.version')}
                {version || t('ui.loading')}
              </span>
              <p className="about-intro">
                {t('ui.anOpenSourceDesktopAppForAIChatAndImageGeneration')}
              </p>
              <p className="about-description">
                {t(
                  'ui.connectToCustomOpenAICompatibleProvidersUsingAPIKeysWithoutSigningUpConversationHistoryStaysOnYourDeviceGenerationRequestsGoDirectlyToYourConfiguredProvider',
                )}
              </p>
              <div className="about-links">
                {(
                  [
                    ['repository', t('ui.githubRepository')],
                    ['issues', t('ui.reportAnIssue')],
                    ['releases', t('ui.releaseNotes')],
                  ] as const
                ).map(([key, label]) => (
                  <a
                    key={key}
                    href={aboutLinks[key]}
                    onClick={(event) => {
                      event.preventDefault()
                      void openLink(key)
                    }}
                  >
                    {label} ↗
                  </a>
                ))}
              </div>
              {linkError && (
                <p role="alert" className="form-error">
                  {translateMessage(linkError)}
                </p>
              )}
              <UpdateNotice manual />
              <footer className="about-footer">
                Made by{' '}
                <a
                  href={aboutLinks.author}
                  onClick={(event) => {
                    event.preventDefault()
                    void openLink('author')
                  }}
                >
                  Frozen · X ↗
                </a>
                <p>{t('ui.licenseMIT')}</p>
                <details>
                  <summary>{t('ui.openSourceAcknowledgments')}</summary>
                  <p>
                    {t(
                      'ui.thanksToTauriReactViteLucideRusqliteReactMarkdownAndOtherOpenSourceProjects',
                    )}
                  </p>
                  <p>{t('ui.dependenciesAreDistributedUnderTheirRespectiveLicenses')}</p>
                </details>
              </footer>
            </section>
          )}
        </div>
      </div>
    </>
  )
  return (
    <div
      className="settings-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
      onMouseDown={close}
    >
      <section className="settings" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
  )
}
