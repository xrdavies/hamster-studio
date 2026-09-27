import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { t } from '../i18n'

type Rect = { x: number; y: number; width: number; height: number }
export default function MarkerEditor({
  file,
  onClose,
  onSave,
}: {
  file: string
  onClose: () => void
  onSave: (marker: string, prompt: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState(''),
    [start, setStart] = useState<{ x: number; y: number } | null>(null),
    [rects, setRects] = useState<Rect[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
    void window.studio
      .readImage(file)
      .then(setSrc)
      .catch((e) => setError(String(e)))
  }, [file])
  const point = (e: React.PointerEvent) => {
    const el = canvas.current!,
      r = el.getBoundingClientRect()
    return {
      x: Math.round(((e.clientX - r.left) * el.width) / r.width),
      y: Math.round(((e.clientY - r.top) * el.height) / r.height),
    }
  }
  function redraw(next = rects) {
    const c = canvas.current?.getContext('2d')
    if (!c) return
    c.clearRect(0, 0, c.canvas.width, c.canvas.height)
    const line = Math.max(4, c.canvas.width / 300),
      size = Math.max(24, c.canvas.width / 32)
    next.forEach((r, i) => {
      c.save()
      c.fillStyle = 'rgba(255, 196, 0, .24)'
      c.fillRect(r.x, r.y, r.width, r.height)
      c.strokeStyle = '#111827'
      c.lineWidth = line
      c.setLineDash([line * 2, line])
      c.strokeRect(r.x, r.y, r.width, r.height)
      c.setLineDash([])
      const radius = size * 0.62,
        x = r.x + radius + line,
        y = r.y + radius + line
      c.fillStyle = '#111827'
      c.beginPath()
      c.arc(x, y, radius, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#fff'
      c.font = `700 ${size}px sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(String(i + 1), x, y + 1)
      c.restore()
    })
  }
  async function save() {
    if (!rects.length || !canvas.current || !image.current) return
    try {
      redraw()
      const output = document.createElement('canvas')
      output.width = canvas.current.width
      output.height = canvas.current.height
      const ctx = output.getContext('2d')!
      ctx.drawImage(image.current, 0, 0)
      ctx.drawImage(canvas.current, 0, 0)
      const marker = await window.studio.saveMarker(file, output.toDataURL('image/png'))
      onSave(
        marker,
        `Region coordinates on the original image (${output.width}×${output.height} pixels), origin at top-left, x rightwards and y downwards: ${rects.map((r, i) => `region ${i + 1}: top-left (${r.x},${r.y}), bottom-right (${r.x + r.width},${r.y + r.height})`).join('; ')}. Match these numbers to the annotated reference. Apply the requested edits only in these regions; preserve all other content.`,
      )
      onClose()
    } catch (reason) {
      setError(String(reason))
    }
  }

  return (
    <dialog
      ref={dialog}
      className="region-editor"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <header>
        <strong>{t('images.smartMarker')}</strong>
        <button className="icon" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="muted">{t('images.markerHelp')}</p>
      <div className="region-viewport">
        <div className="region-stage">
          {src && (
            <img
              ref={image}
              src={src}
              alt={t('ui.referenceImage')}
              onLoad={() => {
                canvas.current!.width = image.current!.naturalWidth
                canvas.current!.height = image.current!.naturalHeight
                redraw()
              }}
            />
          )}
          <canvas
            className="marker-canvas"
            ref={canvas}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setStart(point(e))
            }}
            onPointerMove={(e) => {
              if (!start) return
              const p = point(e),
                r = {
                  x: Math.min(start.x, p.x),
                  y: Math.min(start.y, p.y),
                  width: Math.abs(p.x - start.x),
                  height: Math.abs(p.y - start.y),
                }
              redraw(r.width > 2 && r.height > 2 ? [...rects, r] : rects)
            }}
            onPointerUp={(e) => {
              if (!start) return
              const p = point(e),
                r = {
                  x: Math.min(start.x, p.x),
                  y: Math.min(start.y, p.y),
                  width: Math.abs(p.x - start.x),
                  height: Math.abs(p.y - start.y),
                }
              if (r.width > 2 && r.height > 2) {
                const next = [...rects, r]
                setRects(next)
                redraw(next)
              }
              setStart(null)
            }}
            onPointerCancel={() => setStart(null)}
          />
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <footer>
        <button
          className="secondary"
          disabled={!rects.length}
          onClick={() => {
            setRects([])
            redraw([])
          }}
        >
          {t('images.clearRegion')}
        </button>
        <button className="primary" disabled={!rects.length} onClick={() => void save()}>
          {t('images.useMarker')}
        </button>
      </footer>
    </dialog>
  )
}
