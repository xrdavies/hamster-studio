import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Image as ImageIcon,
  MessageSquare,
  Send,
  SlidersHorizontal,
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
  referenceFile,
  onClearReference,
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
  referenceFile?: string
  onClearReference: () => void
}) {
  const [savingImageModel, setSavingImageModel] = useState(false)
  const [imageSettingError, setImageSettingError] = useState('')
  const [showImageSettings, setShowImageSettings] = useState(false)
  const [referenceSrc, setReferenceSrc] = useState('')
  useEffect(() => {
    let active = true
    setReferenceSrc('')
    if (referenceFile)
      void window.studio
        .readImage(referenceFile)
        .then((src) => {
          if (active) setReferenceSrc(src)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [referenceFile])
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
      <div className="composer">
        <div className="composer-modelbar">
          <ModelMenu choices={choices} selected={selected} onSelect={onModel} disabled={busy} />
          <button
            type="button"
            className="creation-settings-toggle"
            aria-expanded={showImageSettings}
            onClick={() => setShowImageSettings(!showImageSettings)}
          >
            <SlidersHorizontal size={14} />
            {t('图片创作设置')}
          </button>
        </div>
        {showImageSettings && (
          <div className="creation-settings">
            <p>
              {t(
                '对话模型负责规划，图片模型负责生成和编辑。每次任务最多生成 3 张，多图或追加生成需确认。',
              )}
            </p>
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
            {savingImageModel && <span role="status">{t('保存中…')}</span>}
            {imageSettingError && <p className="form-error">{imageSettingError}</p>}
          </div>
        )}
        {referenceFile && (
          <div className="reference-chip">
            {referenceSrc && <img src={referenceSrc} alt={t('参考图片')} />}
            <span>{t('基于此图修改')}</span>
            <button
              type="button"
              aria-label={t('移除参考图片')}
              onClick={onClearReference}
              disabled={busy}
            >
              <X size={14} />
            </button>
          </div>
        )}
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
              modelKind === 'image' ? t('描述你想生成的图片…') : t('给 Hamster Studio 发消息…')
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
            ? t('图片模型：') +
              (session.imageModel || t('未配置')) +
              t(' · Enter 发送 · Shift + Enter 换行')
            : t('聊天模型：') +
              (session.chatModel || t('未配置')) +
              t(' · Enter 发送 · Shift + Enter 换行')}
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
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="model-menu" ref={menuRef}>
      <button
        className="model-trigger"
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={t('选择 Provider · 模型')}
        disabled={disabled}
        aria-expanded={open}
      >
        <span>
          {selected ? `${selected.providerName} · ${selected.model}` : t('选择 Provider · 模型')}
        </span>
        <span className="model-trigger-icon">
          {selected?.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}
          <ChevronDown size={14} />
        </span>
      </button>
      {open && (
        <div className="model-menu-panel" role="listbox">
          {choices.length ? (
            choices.map((choice) => (
              <button
                className="model-option"
                type="button"
                role="option"
                aria-selected={choice === selected}
                key={`${choice.providerId}:${choice.kind}:${choice.model}`}
                onClick={() => {
                  onSelect(choice.providerId, choice.model, choice.kind)
                  setOpen(false)
                }}
              >
                <span>
                  {choice.providerName} · {choice.model}
                </span>
                {choice.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}
              </button>
            ))
          ) : (
            <div className="model-empty">{t('请先在设置中配置模型')}</div>
          )}
        </div>
      )}
    </div>
  )
}
