import { t } from '../i18n'
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
  const [reference, setReference] = useState('')
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
    if (message.referenceFile)
      void window.studio
        .readImage(message.referenceFile)
        .then((src) => {
          if (!cancelled) setReference(src)
        })
        .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [message.id, message.imageFiles.join('|'), message.referenceFile])
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
      <div className="avatar">{message.role === 'user' ? t('你') : 'H'}</div>
      <div className="message-body">
        <div className="message-meta">
          {message.role === 'user' ? t('你') : message.providerName}
          <span>{message.model}</span>
        </div>
        {reference && <img className="message-reference" src={reference} alt={t('参考图片')} />}
        {message.agent &&
          (steps.length > 0 ||
            !!message.viewedImageIds?.length ||
            message.status === 'streaming') && (
            <section className="creation-task" aria-label={t('图片创作任务')}>
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
                      ? '等待确认'
                      : current?.status === 'running'
                        ? '正在制作图片…'
                        : message.status === 'streaming'
                          ? '正在处理任务…'
                          : message.status === 'done'
                            ? '任务完成'
                            : '任务已停止或失败',
                  )}
                </strong>
              </div>
              {!!message.viewedImageIds?.length && (
                <p className="vision-context-note">
                  {t('已载入视觉上下文的图片')} · {message.viewedImageIds.length}
                </p>
              )}
              {steps.length > 0 && (
                <details>
                  <summary>
                    {t('查看执行步骤')} · {steps.length}
                  </summary>
                  {steps.map((step) => (
                    <div className="creation-step" key={step.id}>
                      <span>
                        {t(step.operation === 'edit' ? '修改图片' : '生成图片')} × {step.count} ·{' '}
                        {t(
                          {
                            waiting: '等待确认',
                            running: '执行中',
                            done: '已完成',
                            error: '未完成',
                          }[step.status],
                        )}
                      </span>
                      <p>{step.prompt}</p>
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
                          {t('使用此步骤的原图')}
                        </button>
                      )}
                      {step.error && <p className="form-error">{t(step.error)}</p>}
                    </div>
                  ))}
                </details>
              )}
              {current?.status === 'waiting' && (
                <div className="creation-approval">
                  <p>{current.prompt}</p>
                  <p>
                    {t('本次生成数量')}：{current.count}
                  </p>
                  {current.needsConfiguration && (
                    <p>{t('请在输入框的图片创作设置中选择图片模型，保存后继续。')}</p>
                  )}
                  <div>
                    <button
                      className="secondary"
                      disabled={approving === current.id}
                      onClick={() => void approve(current.id, false)}
                    >
                      {t('取消')}
                    </button>
                    <button
                      className="primary"
                      disabled={approving === current.id}
                      onClick={() => void approve(current.id, true)}
                    >
                      {t('确认生成')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        {!message.agent && message.status === 'streaming' && !message.content && (
          <div className="thinking">
            <span className="spinner dark" />
            {t(message.kind === 'image' ? '正在生成图片…' : '正在思考…')}
          </div>
        )}
        {message.content && (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.error && <div className="form-error">{t(message.error)}</div>}
        {images.map((image) => (
          <div className="generated-image-wrap" key={image.file}>
            <button
              className="image-preview-trigger"
              aria-label={t('放大查看')}
              onClick={() => setPreview(image.src)}
            >
              <img className="generated-image" src={image.src} alt={t('生成的图片')} />
            </button>
            <div className="image-card-actions">
              <button onClick={() => void onExport(image.file)}>
                <Download size={13} />
                {t('导出图片')}
              </button>
              <button disabled={busy} onClick={() => onReference(image.file)}>
                <Pencil size={13} />
                {t('基于此图修改')}
              </button>
              <button
                onClick={() =>
                  onRegenerate(
                    steps.find((s) => s.imageFiles.includes(image.file))?.prompt || message.content,
                  )
                }
              >
                <RefreshCw size={13} />
                {t('重新生成')}
              </button>
            </div>
          </div>
        ))}
        {message.role === 'assistant' && (
          <div className="message-actions">
            <button onClick={onCopy}>
              <Copy size={13} />
              {t('复制')}
            </button>
            {!message.agent && message.status !== 'streaming' && (
              <button onClick={() => onRetry(message)}>
                <RefreshCw size={13} />
                {t('重试')}
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
            aria-label={t('关闭')}
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
          {preview && <img src={preview} alt={t('生成的图片')} />}
        </dialog>
      </div>
    </div>
  )
}
