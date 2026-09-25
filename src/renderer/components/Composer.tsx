import RegionEditor from './RegionEditor'
import { t } from '../i18n'
import { useEffect, useId, useRef, useState } from 'react'
import {
  ChevronDown,
  Image as ImageIcon,
  MessageSquare,
  Send,
  SlidersHorizontal,
  ImagePlus,
  Info,
  Paintbrush,
  X,
} from 'lucide-react'
import type { Provider, StudioSession } from '../../shared/types'
import type { ModelKind } from '../../shared/model-capabilities'

type ModelChoice = { providerId: string; providerName: string; model: string; kind: ModelKind }

export default function Composer({
  providers,
  session,
  modelKind,
  currentModel,
  busy,
  text,
  setText,
  onModel,
  onSubmit,
  onStop,
  onImageModel,
  referenceFiles,
  mask,
  onMask,
  onClearReference,
  onImportImage,
}: {
  providers: Provider[]
  session: StudioSession
  modelKind: ModelKind
  currentModel: string
  busy: boolean
  text: string
  setText: (value: string) => void
  onModel: (providerId: string, model: string, kind: ModelKind) => void
  onSubmit: () => void
  onStop: () => void
  onImageModel: (providerId: string, model: string) => Promise<void>
  referenceFiles: string[]
  mask?: { file: string; mask: string }
  onMask: (value?: { file: string; mask: string }) => void
  onImportImage: () => Promise<void>
  onClearReference: (file: string) => void
}) {
  const [editing, setEditing] = useState('')
  const [importing, setImporting] = useState(false)
  const [savingImageModel, setSavingImageModel] = useState(false)
  const [imageSettingError, setImageSettingError] = useState('')
  const [showImageSettings, setShowImageSettings] = useState(false)
  const [referenceSrc, setReferenceSrc] = useState<Record<string, string>>({})
  const settingsPanel = useRef<HTMLDivElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const settingsId = useId()
  useEffect(() => {
    if (!showImageSettings) return
    settingsPanel.current?.querySelector<HTMLButtonElement>('.model-trigger')?.focus()
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!settingsPanel.current?.contains(target) && !settingsButton.current?.contains(target))
        setShowImageSettings(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [showImageSettings])
  useEffect(() => {
    setShowImageSettings(false)
  }, [session.id])

  useEffect(() => {
    let active = true
    void Promise.all(
      referenceFiles.map(async (file) => [
        file,
        await window.studio.readImage(file).catch(() => ''),
      ]),
    ).then((entries) => {
      if (active) setReferenceSrc(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
  }, [referenceFiles.join('|')])
  const choices = providers.flatMap((provider) => [
    ...provider.chatModels.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      model,
      kind: 'chat' as const,
    })),
    ...provider.imageModels.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      model,
      kind: 'image' as const,
    })),
  ])
  const selected = choices.find(
    (choice) =>
      choice.providerId === session.providerId &&
      choice.kind === modelKind &&
      choice.model === currentModel,
  )
  return (
    <div className="composer-wrap">
      {editing && (
        <RegionEditor
          file={editing}
          onClose={() => setEditing('')}
          onSave={(value) => onMask({ file: editing, mask: value })}
        />
      )}
      <div className="composer">
        <div className="composer-modelbar">
          <ModelMenu choices={choices} selected={selected} onSelect={onModel} disabled={busy} />
          <button
            type="button"
            className="creation-settings-toggle composer-icon-button"
            title={t('ui.imageCreationSettings')}
            aria-label={t('ui.imageCreationSettings')}
            ref={settingsButton}
            aria-controls={showImageSettings ? settingsId : undefined}
            aria-expanded={showImageSettings}
            onClick={() => setShowImageSettings(!showImageSettings)}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            type="button"
            className="creation-settings-toggle composer-icon-button"
            title={t(importing ? 'images.importing' : 'images.addLocal')}
            aria-label={t(importing ? 'images.importing' : 'images.addLocal')}
            disabled={busy || importing}
            onClick={() => {
              setImporting(true)
              void onImportImage().finally(() => setImporting(false))
            }}
          >
            {importing ? <span className="spinner dark" /> : <ImagePlus size={16} />}
          </button>
        </div>
        {showImageSettings && (
          <div
            className="creation-settings"
            ref={settingsPanel}
            id={settingsId}
            role="region"
            aria-label={t('ui.imageCreationSettings')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setShowImageSettings(false)
                settingsButton.current?.focus()
              }
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== settingsButton.current
              )
                setShowImageSettings(false)
            }}
          >
            <span className="creation-settings-label">
              <ImageIcon size={14} />
              {t('composer.imageModel')}
            </span>
            <ModelMenu
              choices={choices.filter((c) => c.kind === 'image')}
              selected={choices.find(
                (c) =>
                  c.kind === 'image' &&
                  c.providerId === (session.imageProviderId ?? session.providerId) &&
                  c.model === session.imageModel,
              )}
              disabled={savingImageModel}
              onSelect={(providerId, model) => {
                setSavingImageModel(true)
                setImageSettingError('')
                void onImageModel(providerId, model)
                  .catch((error) => setImageSettingError(String(error)))
                  .finally(() => setSavingImageModel(false))
              }}
            />
            <button
              type="button"
              className="creation-settings-help"
              title={t(
                'ui.viewingImagesRequiresAVisionCapableConversationModelImagesAreSentToThatModelSProvider',
              )}
              aria-label={t(
                'ui.viewingImagesRequiresAVisionCapableConversationModelImagesAreSentToThatModelSProvider',
              )}
            >
              <Info size={14} />
            </button>
            {savingImageModel && <span role="status">{t('ui.saving')}</span>}
            {imageSettingError && <p className="form-error">{imageSettingError}</p>}
          </div>
        )}
        <div className="reference-list">
          {referenceFiles.map((file, index) => (
            <div className="reference-chip" key={file}>
              {referenceSrc[file] && <img src={referenceSrc[file]} alt={t('ui.referenceImage')} />}
              <span className="reference-label">
                {t('ui.referenceImage')} {index + 1}
              </span>
              <button
                type="button"
                disabled={busy}
                className={mask?.file === file ? 'reference-edit selected' : 'reference-edit'}
                aria-pressed={mask?.file === file}
                title={t('images.editRegion')}
                aria-label={t('images.editRegion')}
                onClick={() => setEditing(file)}
              >
                <Paintbrush size={14} />
              </button>
              {mask?.file === file && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMask(undefined)}
                  className="reference-region-status"
                  aria-label={t('images.removeRegion')}
                  title={t('images.removeRegion')}
                >
                  {t('images.regionSelected')} <X size={12} />
                </button>
              )}
              <button
                type="button"
                aria-label={t('ui.removeReferenceImage')}
                onClick={() => onClearReference(file)}
                disabled={busy}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="composer-input">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSubmit()
              }
            }}
            placeholder={
              modelKind === 'image'
                ? t('ui.describeTheImageYouWantToGenerate')
                : t('ui.messageHamsterStudio')
            }
            disabled={busy}
          />
          <button
            className="send"
            onClick={busy ? onStop : onSubmit}
            disabled={!busy && !text.trim()}
          >
            {busy ? <span className="spinner" /> : <Send size={18} />}
          </button>
        </div>
        <div className="hint">
          {modelKind === 'image'
            ? t('ui.imageModel') +
              (session.imageModel || t('ui.notConfigured')) +
              t('ui.enterToSendShiftEnterForANewLine')
            : t('ui.chatModel') +
              (session.chatModel || t('ui.notConfigured')) +
              t('ui.enterToSendShiftEnterForANewLine')}
        </div>
      </div>
    </div>
  )
}

function ModelMenu({
  choices,
  selected,
  onSelect,
  disabled = false,
}: {
  choices: ModelChoice[]
  disabled?: boolean
  selected?: ModelChoice
  onSelect: (providerId: string, model: string, kind: ModelKind) => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"], [role="option"]')
      ?.focus()
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div
      className="model-menu"
      ref={menuRef}
      onBlur={(event) => {
        // WebKit can report no next focus target during a mouse click.
        // Outside pointer events handle dismissal in that case.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          if (!open) {
            setOpen(true)
            return
          }
          const options = Array.from(
            menuRef.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
          )
          if (!options.length) return
          const index = options.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? options.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[next]?.focus()
        }
      }}
    >
      <button
        className="model-trigger"
        ref={triggerRef}
        title={selected ? `${selected.providerName} · ${selected.model}` : undefined}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t('ui.selectProviderModel')}
        disabled={disabled}
        aria-expanded={open}
      >
        <span>
          {selected ? `${selected.providerName} · ${selected.model}` : t('ui.selectProviderModel')}
        </span>
        <span className="model-trigger-icon">
          {selected?.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}
          <ChevronDown size={14} />
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          className="model-menu-panel"
          role="listbox"
          aria-label={t('ui.selectProviderModel')}
        >
          {choices.length ? (
            choices.map((choice) => (
              <button
                className="model-option"
                type="button"
                title={`${choice.providerName} · ${choice.model}`}
                role="option"
                aria-selected={choice === selected}
                key={`${choice.providerId}:${choice.kind}:${choice.model}`}
                onClick={() => {
                  onSelect(choice.providerId, choice.model, choice.kind)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <span>
                  {choice.providerName} · {choice.model}
                </span>
                {choice.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}
              </button>
            ))
          ) : (
            <div className="model-empty">{t('ui.configureModelsInSettingsFirst')}</div>
          )}
        </div>
      )}
    </div>
  )
}
