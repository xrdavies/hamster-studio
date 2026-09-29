import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../shared/types'
import TaskStatus from './TaskStatus'
vi.mock('../i18n', () => ({ t: (key: string) => key }))

it('shows post-image checking only while active, with retry and unfinished steps taking priority', () => {
  const message = {
    agent: true,
    status: 'streaming',
    imageFiles: ['done.png'],
    steps: [{ status: 'done' }],
  } as Message
  const render = (changes: Partial<Message> = {}) =>
    renderToStaticMarkup(<TaskStatus message={{ ...message, ...changes }} />)
  expect(render()).toContain('agent.checkingResult')
  expect(render({ retryAttempt: 1 })).toContain('retry.running')
  expect(render({ retryAttempt: 1 })).not.toContain('agent.checkingResult')
  for (const status of ['done', 'error'] as const) expect(render({ status })).toBe('')
  for (const status of ['waiting', 'running', 'error'] as const) {
    expect(render({ steps: [{ ...message.steps![0], status }] })).toBe('')
  }
  expect(render({ imageFiles: [] })).toBe('')
  expect(render({ webStatus: 'reading' })).toBe('')
  expect(render({ agent: false })).toBe('')
})
