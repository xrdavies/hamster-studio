import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnimationPreview from './AnimationPreview'
vi.mock('../i18n', () => ({ t: (key: string) => key }))
it('exposes playback, frame navigation and both exports for a saved animation', () => {
  const html = renderToStaticMarkup(
    <AnimationPreview
      messageId="message-a"
      animation={{
        file: 'a.gif',
        frameFiles: ['1.png', '2.png'],
        fps: 8,
        looped: true,
        width: 256,
        height: 256,
      }}
    />,
  )
  for (const key of [
    'animation.play',
    'animation.previous',
    'animation.next',
    'animation.exportGif',
    'animation.exportFrames',
    'animation.speed',
  ])
    expect(html).toContain(key)
  expect(html).toContain('256 × 256')
})
