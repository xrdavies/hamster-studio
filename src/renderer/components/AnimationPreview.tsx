import { useEffect, useState } from 'react'
import { Play, Pause, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { t } from '../i18n'
import type { AnimationResult } from '../../shared/types'

export default function AnimationPreview({
  animation,
  messageId,
}: {
  animation: AnimationResult
  messageId: string
}) {
  const [frames, setFrames] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(animation.fps)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    let disposed = false
    setFrames([])
    setIndex(0)
    setPlaying(false)
    void Promise.all(animation.frameFiles.map((file) => window.studio.readImage(file)))
      .then((values) => {
        if (!disposed) setFrames(values)
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason))
      })
    return () => {
      disposed = true
    }
  }, [animation.file])
  useEffect(() => {
    if (!playing || !frames.length) return
    const timer = window.setTimeout(() => {
      if (index + 1 < frames.length) setIndex(index + 1)
      else if (animation.looped) setIndex(0)
      else setPlaying(false)
    }, 1000 / fps)
    return () => window.clearTimeout(timer)
  }, [playing, frames.length, index, fps, animation.looped])
  async function exportFile(frames: boolean) {
    setExporting(true)
    setError('')
    try {
      await window.studio.exportAnimation(messageId, animation.file, frames)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setExporting(false)
    }
  }
  return (
    <section className="animation-preview" aria-label={t('animation.title')}>
      <strong>{t('animation.title')}</strong>
      <p>
        {animation.width} × {animation.height} · {animation.frameFiles.length}{' '}
        {t('animation.frames')} · {animation.fps} FPS
      </p>
      {frames[index] && (
        <img
          className="generated-image"
          src={frames[index]}
          alt={`${t('animation.frame')} ${index + 1}`}
        />
      )}
      <div className="animation-controls">
        <button
          className="secondary"
          disabled={!frames.length}
          aria-label={t(playing ? 'animation.pause' : 'animation.play')}
          onClick={() => {
            if (!playing && index === frames.length - 1) setIndex(0)
            setPlaying(!playing)
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="secondary"
          disabled={!frames.length}
          aria-label={t('animation.previous')}
          onClick={() => {
            setPlaying(false)
            setIndex((index + frames.length - 1) % frames.length)
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {frames.length ? index + 1 : 0}/{animation.frameFiles.length}
        </span>
        <button
          className="secondary"
          disabled={!frames.length}
          aria-label={t('animation.next')}
          onClick={() => {
            setPlaying(false)
            setIndex((index + 1) % frames.length)
          }}
        >
          <ChevronRight size={16} />
        </button>
        <label>
          {t('animation.speed')}{' '}
          <select value={fps} onChange={(event) => setFps(Number(event.target.value))}>
            {[...new Set([4, 8, 12, 16, 24, 30, animation.fps])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value} FPS
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="animation-controls">
        <button className="secondary" disabled={exporting} onClick={() => void exportFile(false)}>
          <Download size={14} /> {t('animation.exportGif')}
        </button>
        <button className="secondary" disabled={exporting} onClick={() => void exportFile(true)}>
          <Download size={14} /> {t('animation.exportFrames')}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  )
}
