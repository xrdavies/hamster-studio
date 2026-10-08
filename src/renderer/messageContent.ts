import type { Message } from '../shared/types'

export function shouldRenderContent(
  message: Pick<Message, 'agent' | 'status' | 'imageFiles' | 'content'>,
) {
  if (!message.agent || message.status !== 'error' || message.imageFiles.length > 0) return true
  return !/(?:图片|图像)(?:已经|已)?(?:生成|保存|完成|做好|准备好)|(?:the )?(?:image|picture)(?: has been| was)? (?:generated|saved|created|ready)/i.test(
    message.content,
  )
}
