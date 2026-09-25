import { useEffect, useRef, useState } from 'react'
import { X, Undo2 } from 'lucide-react'
import { t } from '../i18n'

// The visible brush overlay becomes transparent pixels in the exported edit mask.
export function maskPixels(pixels: Uint8ClampedArray) {
  for (let i = 0; i < pixels.length; i += 4) {
    const selected = pixels[i + 3] > 0
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255
    pixels[i + 3] = selected ? 0 : 255
  }
}

export default function RegionEditor({
  file,
  initialMask,
  readOnly = false,
  onSave,
  onClose,
}: {
  file: string
  initialMask?: string
  readOnly?: boolean
  onSave: (mask: string) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // ponytail: retain one full-resolution snapshot; use stroke replay for deeper undo.
  const undo = useRef<ImageData | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [eraser, setEraser] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [ready, setReady] = useState(false)
  const [src, setSrc] = useState('')
  const [brush, setBrush] = useState(30)
  const [marked, setMarked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const previous = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    dialog.current?.showModal()
    let active = true
    void window.studio
      .readImage(file)
      .then((value) => {
        if (active) setSrc(value)
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
    return () => {
      active = false
    }
  }, [file])
  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    const el = event.currentTarget
    const rect = el.getBoundingClientRect()
    const point = {
      x: ((event.clientX - rect.left) * el.width) / rect.width,
      y: ((event.clientY - rect.top) * el.height) / rect.height,
    }
    const ctx = el.getContext('2d')!
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#8864ed'
    ctx.fillStyle = '#8864ed'
    ctx.lineWidth = (brush * el.width) / rect.width
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(previous.current?.x ?? point.x, previous.current?.y ?? point.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    previous.current = point
    setMarked(true)
  }
  async function save() {
    setSaving(true)
    setError('')
    try {
      const source = canvas.current!
      const output = document.createElement('canvas')
      output.width = source.width
      output.height = source.height
      const ctx = output.getContext('2d')!
      const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height)
      if (!pixels.data.some((value, index) => index % 4 === 3 && value > 0))
        throw new Error(t('images.selectRegionFirst'))
      maskPixels(pixels.data)
      ctx.putImageData(pixels, 0, 0)
      onSave(await window.studio.saveMask(file, output.toDataURL('image/png')))
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="region-editor"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <header>
        <strong>{t('images.editRegion')}</strong>
        <button className="icon" aria-label={t('ui.close')} disabled={saving} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="muted">{t('images.regionHelp')}</p>
      <div className="region-viewport">
        <div className="region-stage" style={{ width: `${zoom * 100}%` }}>
          {src && (
            <img
              src={src}
              alt={t('ui.referenceImage')}
              onLoad={async (event) => {
                const image = event.currentTarget
                if (image.naturalWidth * image.naturalHeight > 32_000_000) {
                  setError(t('images.regionTooLarge'))
                  setSrc('')
                  return
                }
                canvas.current!.width = image.naturalWidth
                canvas.current!.height = image.naturalHeight
                try {
                  if (initialMask) {
                    const maskImage = new Image()
                    maskImage.src = await window.studio.readImage(initialMask)
                    await maskImage.decode()
                    const el = canvas.current
                    if (!el) return
                    const ctx = el.getContext('2d')!
                    ctx.drawImage(maskImage, 0, 0)
                    const pixels = ctx.getImageData(0, 0, el.width, el.height)
                    for (let i = 0; i < pixels.data.length; i += 4) {
                      const selected = pixels.data[i + 3] < 255
                      pixels.data.set([136, 100, 237, selected ? 255 : 0], i)
                    }
                    ctx.putImageData(pixels, 0, 0)
                    setMarked(true)
                  }
                  setReady(true)
                } catch (reason) {
                  setError(String(reason))
                }
              }}
            />
          )}
          <canvas
            ref={canvas}
            aria-label={t('images.editRegion')}
            onPointerDown={(event) => {
              if (!ready || readOnly || saving || event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const el = event.currentTarget
              undo.current = el.getContext('2d')!.getImageData(0, 0, el.width, el.height)
              setCanUndo(true)
              previous.current = null
              draw(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) draw(event)
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
              previous.current = null
            }}
            onPointerCancel={() => {
              previous.current = null
            }}
          />
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <footer>
        <label>
          {t('images.zoom')}
          <input
            type="range"
            min="1"
            max="3"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        {!readOnly && (
          <>
            <button
              className="secondary"
              aria-pressed={eraser}
              disabled={saving}
              onClick={() => setEraser(!eraser)}
            >
              {t(eraser ? 'images.eraser' : 'images.brush')}
            </button>
            <button
              className="secondary"
              disabled={!canUndo || saving}
              onClick={() => {
                canvas.current!.getContext('2d')!.putImageData(undo.current!, 0, 0)
                undo.current = null
                setCanUndo(false)
                setMarked(true)
              }}
            >
              {t('images.undoStroke')}
            </button>
            <label>
              {t('images.brushSize')}{' '}
              <input
                type="range"
                min="5"
                max="100"
                value={brush}
                onChange={(event) => setBrush(Number(event.target.value))}
              />
            </label>
            <button
              className="secondary"
              disabled={saving || !marked}
              onClick={() => {
                const el = canvas.current!
                undo.current = el.getContext('2d')!.getImageData(0, 0, el.width, el.height)
                setCanUndo(true)
                el.getContext('2d')!.clearRect(0, 0, el.width, el.height)
                setMarked(false)
              }}
            >
              <Undo2 size={14} />
              {t('images.clearRegion')}
            </button>
            <button className="primary" disabled={saving || !marked} onClick={() => void save()}>
              {t('images.useRegion')}
            </button>
          </>
        )}
      </footer>
    </dialog>
  )
}
