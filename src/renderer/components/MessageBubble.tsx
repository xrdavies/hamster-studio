import { translateMessage, t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Download, RefreshCw, Pencil, X, Check } from 'lucide-react'
import type { Message } from '../../shared/types'

export default function MessageBubble({
  message,
  busy,
  onRetry,
  onCopy,
  onExport,
  onReference,
  onRegenerate,
  onApprove,
}: {
  busy: boolean
  message: Message
  onRetry: (message: Message) => void
  onCopy: () => void
  onExport: (file: string) => Promise<void>
  onReference: (file: string) => void
  onRegenerate: (prompt: string) => void
  onApprove: (stepId: string, allow: boolean) => Promise<void>
}) {
  const [images, setImages] = useState<{ file: string; src: string }[]>([])
  const [references, setReferences] = useState<string[]>([])
  const [preview, setPreview] = useState('')
  const [approving, setApproving] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all(
      message.imageFiles.map(async (file) => ({
        file,
        src: await window.studio.readImage(file).catch(() => ''),
      })),
    ).then((values) => {
      if (!cancelled) setImages(values.filter((item) => item.src))
    })
    void Promise.all(
      (message.referenceFiles || (message.referenceFile ? [message.referenceFile] : [])).map(
        (file) => window.studio.readImage(file).catch(() => ''),
      ),
    ).then((values) => {
      if (!cancelled) setReferences(values.filter(Boolean))
    })
    return () => {
      cancelled = true
    }
  }, [
    message.id,
    message.imageFiles.join('|'),
    message.referenceFile,
    message.referenceFiles?.join('|'),
  ])
  useEffect(() => {
    if (preview) dialog.current?.showModal()
  }, [preview])
  const steps = message.steps || []
  const current = steps.find((step) => step.status === 'waiting' || step.status === 'running')
  const approve = async (id: string, allow: boolean) => {
    setApproving(id)
    try {
      await onApprove(id, allow)
    } finally {
      setApproving('')
    }
  }
  return (
    <div className={message.role === 'user' ? 'message user' : 'message assistant'}>
      <div className="avatar">{message.role === 'user' ? t('ui.you') : 'H'}</div>
      <div className="message-body">
        <div className="message-meta">
          {message.role === 'user' ? t('ui.you') : message.providerName}
          <span>{message.model}</span>
        </div>
        {references.map((reference, index) => (
          <img
            key={index}
            className="message-reference"
            src={reference}
            alt={t('ui.referenceImage')}
          />
        ))}
        {message.agent &&
          (steps.length > 0 ||
            !!message.viewedImageIds?.length ||
            message.status === 'streaming') && (
            <section className="creation-task" aria-label={t('ui.imageCreationTask')}>
              <div className="creation-task-title" role="status">
                {message.status === 'streaming' ? (
                  <span className="spinner dark" />
                ) : message.status === 'done' ? (
                  <Check size={16} />
                ) : (
                  <X size={16} />
                )}
                <strong>
                  {t(
                    current?.status === 'waiting'
                      ? 'ui.awaitingConfirmation'
                      : current?.status === 'running'
                        ? 'ui.creatingImages'
                        : message.status === 'streaming'
                          ? 'ui.working'
                          : message.status === 'done'
                            ? 'ui.taskComplete'
                            : 'ui.taskStoppedOrFailed',
                  )}
                </strong>
              </div>
              {!!message.viewedImageIds?.length && (
                <p className="vision-context-note">
                  {t('ui.imagesLoadedIntoVisualContext')} · {message.viewedImageIds.length}
                </p>
              )}
              {steps.length > 0 && (
                <details>
                  <summary>
                    {t('ui.viewSteps')} · {steps.length}
                  </summary>
                  {steps.map((step) => (
                    <div className="creation-step" key={step.id}>
                      <span>
                        {t(step.operation === 'edit' ? 'ui.editImage' : 'ui.generateImage')} ×{' '}
                        {step.count} ·{' '}
                        {t(
                          (
                            {
                              waiting: 'ui.awaitingConfirmation',
                              running: 'ui.running',
                              done: 'ui.completed',
                              error: 'ui.incomplete',
                            } as const
                          )[step.status],
                        )}
                      </span>
                      <p>{step.prompt}</p>
                      {step.dispatchState === 'unknown' && step.status === 'error' && (
                        <p className="form-error">{t('agent.unknownResult')}</p>
                      )}
                      {step.model && (
                        <small>
                          {step.providerName} · {step.model}
                        </small>
                      )}
                      {step.sourceImageId && (
                        <button
                          className="source-image-link"
                          disabled={busy}
                          onClick={() => onReference(step.sourceImageId!)}
                        >
                          <Pencil size={13} />
                          {t('ui.useThisStepSSourceImage')}
                        </button>
                      )}
                      {step.error && <p className="form-error">{translateMessage(step.error)}</p>}
                    </div>
                  ))}
                </details>
              )}
              {current?.status === 'waiting' && (
                <div className="creation-approval">
                  <p>{current.prompt}</p>
                  {current.repeated && <p className="form-error">{t('agent.repeatWarning')}</p>}
                  <p>
                    {t('ui.imagesInThisStep')}：{current.count}
                  </p>
                  {current.needsConfiguration && (
                    <p>
                      {t('ui.chooseAnImageModelInTheComposerSImageCreationSettingsThenContinue')}
                    </p>
                  )}
                  <div>
                    <button
                      className="secondary"
                      disabled={approving === current.id}
                      onClick={() => void approve(current.id, false)}
                    >
                      {t('ui.cancel')}
                    </button>
                    <button
                      className="primary"
                      disabled={approving === current.id}
                      onClick={() => void approve(current.id, true)}
                    >
                      {t('ui.confirmGeneration')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        {!message.agent && message.status === 'streaming' && !message.content && (
          <div className="thinking">
            <span className="spinner dark" />
            {t(message.kind === 'image' ? 'ui.generatingImage' : 'ui.thinking')}
          </div>
        )}
        {message.webStatus && (
          <div className="vision-context-note" role="status">
            {t(
              message.webStatus === 'reading' && message.status === 'streaming'
                ? 'web.reading'
                : message.webStatus === 'done'
                  ? 'web.done'
                  : 'web.failed',
            )}
            {message.webError && <span> · {translateMessage(message.webError)}</span>}
          </div>
        )}
        {!!message.retryAttempt && message.status === 'streaming' && (
          <p role="status" className="vision-context-note">
            {t('agent.retrying', {
              attempt: message.retryAttempt,
              seconds: message.retryDelay || 0,
            })}
          </p>
        )}
        {message.canContinue && message.status === 'error' && (
          <button className="secondary" disabled={busy} onClick={() => onRetry(message)}>
            {t('agent.continue')}
          </button>
        )}
        {message.content && (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.error && <div className="form-error">{translateMessage(message.error)}</div>}
        {message.errorDetail && (
          <details>
            <summary>{t('agent.errorDetails')}</summary>
            <p className="form-error">{message.errorDetail}</p>
          </details>
        )}
        {images.map((image) => (
          <div className="generated-image-wrap" key={image.file}>
            <button
              className="image-preview-trigger"
              aria-label={t('ui.viewFullSize')}
              onClick={() => setPreview(image.src)}
            >
              <img className="generated-image" src={image.src} alt={t('ui.generatedImage')} />
            </button>
            <div className="image-card-actions">
              <button
                title={t('ui.exportImage')}
                aria-label={t('ui.exportImage')}
                onClick={() => void onExport(image.file)}
              >
                <Download size={13} />
              </button>
              <button
                title={t('ui.editThisImage')}
                aria-label={t('ui.editThisImage')}
                disabled={busy}
                onClick={() => onReference(image.file)}
              >
                <Pencil size={13} />
              </button>
              <button
                title={t('ui.generateAgain')}
                aria-label={t('ui.generateAgain')}
                onClick={() =>
                  onRegenerate(
                    steps.find((s) => s.imageFiles.includes(image.file))?.prompt || message.content,
                  )
                }
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
        ))}
        {message.role === 'assistant' && (
          <div className="message-actions">
            <button onClick={onCopy}>
              <Copy size={13} />
              {t('ui.copy')}
            </button>
            {!message.agent && message.status !== 'streaming' && (
              <button onClick={() => onRetry(message)}>
                <RefreshCw size={13} />
                {t('ui.retry')}
              </button>
            )}
          </div>
        )}
        <dialog
          className="image-preview-dialog"
          ref={dialog}
          onClose={() => setPreview('')}
          onClick={(event) => {
            if (event.target === event.currentTarget) dialog.current?.close()
          }}
        >
          <button
            className="preview-close"
            aria-label={t('ui.close')}
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
          {preview && <img src={preview} alt={t('ui.generatedImage')} />}
        </dialog>
      </div>
    </div>
  )
}
