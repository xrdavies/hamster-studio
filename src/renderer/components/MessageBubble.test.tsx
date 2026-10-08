import { expect, it } from 'vitest'
import { shouldRenderContent } from '../messageContent'

const message = {
  agent: true,
  status: 'error' as const,
  imageFiles: [],
  content: '',
}

it('hides an unverified image success claim after an agent request fails', () => {
  expect(shouldRenderContent({ ...message, content: '图片已经保存' })).toBe(false)
  expect(shouldRenderContent({ ...message, content: '图片已生成并保存好了' })).toBe(false)
  expect(
    shouldRenderContent({ ...message, content: '图片已保存', imageFiles: ['image.png'] }),
  ).toBe(true)
  expect(shouldRenderContent({ ...message, content: '网络中断，请稍后重试' })).toBe(true)
  expect(shouldRenderContent({ ...message, agent: false, content: '图片已保存' })).toBe(true)
})
