import { t } from '../i18n'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Download, RefreshCw } from 'lucide-react'
import type { Message } from '../../shared/types'

export default function MessageBubble({
  message,
  onRetry,
  onCopy,
  onExport,
}: {
  message: Message
  onRetry: (message: Message) => void
  onCopy: () => void
  onExport: (file: string) => Promise<void>
}) {
  const [images, setImages] = useState<{ file: string; src: string }[]>([])
  useEffect(() => {
    let cancelled = false
    if (message.kind === 'image')
      Promise.all(
        message.imageFiles.map(async (file) => ({
          file,
          src: await window.studio.readImage(file).catch(() => ''),
        })),
      ).then((values) => {
        if (!cancelled) setImages(values.filter((item) => item.src))
      })
    return () => {
      cancelled = true
    }
  }, [message.id, message.imageFiles.join('|')])
  return (
    <div className={message.role === 'user' ? 'message user' : 'message assistant'}>
      <div className="avatar">{message.role === 'user' ? t('你') : 'H'}</div>
      <div className="message-body">
        <div className="message-meta">
          {message.role === 'user' ? t('你') : message.providerName}
          <span>{message.model}</span>
        </div>
        {message.kind === 'image' ? (
          <>
            {message.content && <p>{message.content}</p>}
            {message.status === 'streaming' && (
              <div className="image-loading">
                <span className="spinner dark" />
                {t('正在生成图片…')}
              </div>
            )}
            {message.error && <div className="image-error">{t(message.error)}</div>}
            {images.map((image) => (
              <div className="generated-image-wrap" key={image.file}>
                <img className="generated-image" src={image.src} />
                <button className="export-image" onClick={() => void onExport(image.file)}>
                  <Download size={13} />
                  {t('导出图片')}
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            {message.status === 'streaming' && !message.content && (
              <div className="thinking">
                <span className="spinner dark" />
                {t('正在思考…')}
              </div>
            )}
            <div className="markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || t(message.error) || '▍'}
              </ReactMarkdown>
            </div>
          </>
        )}
        {message.role === 'assistant' && (
          <div className="message-actions">
            <button onClick={onCopy}>
              <Copy size={13} />
              {t('复制')}
            </button>
            <button onClick={() => onRetry(message)}>
              <RefreshCw size={13} />
              {t('重试')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
