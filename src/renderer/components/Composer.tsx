import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Image as ImageIcon, MessageSquare, Send } from 'lucide-react'
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
}) {
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
          <ModelMenu choices={choices} selected={selected} onSelect={onModel} />
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
}: {
  choices: ModelChoice[]
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
