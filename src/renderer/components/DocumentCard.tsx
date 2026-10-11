import { useEffect, useState } from 'react'
import { Download, FileDown, Pencil, Replace } from 'lucide-react'
import { t } from '../i18n'
import type { PsdDocument } from '../../shared/types'

export default function DocumentCard({
  document,
  busy,
  onPreview,
  onSave,
  onExportPng,
  onReplaceOriginal,
  onEdit,
}: {
  document: PsdDocument
  busy: boolean
  onPreview: (src: string) => void
  onSave: () => void
  onExportPng: () => void
  onReplaceOriginal: () => void
  onEdit: () => void
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void window.studio
      .readImage(document.previewImageId)
      .catch(() => '')
      .then((value) => {
        if (active) setSrc(value)
      })
    return () => {
      active = false
    }
  }, [document.previewImageId])
  const warnings = document.warnings?.length || 0
  return (
    <div className="generated-image-wrap document-card">
      <div className="vision-context-note">
        {document.name} · v{document.version} · {document.width}×{document.height} ·{' '}
        {t('documents.layers', { count: document.layerCount })}
      </div>
      {src && (
        <button
          className="image-preview-trigger"
          aria-label={t('ui.viewFullSize')}
          onClick={() => onPreview(src)}
        >
          <img className="generated-image" src={src} alt={t('documents.preview')} />
        </button>
      )}
      {warnings > 0 && (
        <p className="form-error" title={document.warnings?.join('\n')}>
          {t('documents.warnings', { count: warnings })}
        </p>
      )}
      <div className="image-card-actions">
        <button title={t('documents.saveAs')} aria-label={t('documents.saveAs')} onClick={onSave}>
          <Download size={13} />
        </button>
        <button
          title={t('documents.exportPng')}
          aria-label={t('documents.exportPng')}
          onClick={onExportPng}
        >
          <FileDown size={13} />
        </button>
        {document.canReplaceOriginal && document.version > 1 ? (
          <button
            title={t('documents.replaceOriginal')}
            aria-label={t('documents.replaceOriginal')}
            disabled={busy}
            onClick={onReplaceOriginal}
          >
            <Replace size={13} />
          </button>
        ) : null}
        <button
          title={t('documents.editVersion')}
          aria-label={t('documents.editVersion')}
          disabled={busy}
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
      </div>
    </div>
  )
}
