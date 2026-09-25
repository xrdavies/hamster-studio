import { afterEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { StudioData } from '../shared/types'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))
vi.mock('./i18n', () => ({
  t: (text: string) => text,
  translateMessage: (text: string) => text,
  useLanguage: () => 'en',
}))
import App from './App'
import Composer from './components/Composer'
import SessionSidebar from './components/SessionSidebar'
import MessageBubble from './components/MessageBubble'
import SettingsPanel, { makeEditing } from './components/SettingsPanel'

function find(node: unknown, type: unknown): ReactElement<Record<string, any>> | undefined {
  if (!node || typeof node !== 'object') return
  const element = node as ReactElement<Record<string, any>>
  if (element.type === type) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const result = find(child, type)
    if (result) return result
  }
}
const render = () => {
  hooks.index = 0
  return App()
}
afterEach(() => {
  hooks.values = []
  vi.unstubAllGlobals()
})

it('isolates drafts, pending requests, errors and image retries when switching sessions', async () => {
  const data: StudioData = {
    providers: [
      {
        id: 'p',
        name: 'Relay',
        baseUrl: 'https://example.com',
        chatModels: ['chat'],
        imageModels: ['image'],
        hasKey: true,
      },
    ],
    sessions: ['a', 'b'].map((id) => ({
      id,
      title: id,
      providerId: 'p',
      modelKind: id === 'a' ? 'image' : 'chat',
      chatModel: 'chat',
      imageModel: 'image',
      systemPrompt: '',
      createdAt: 1,
      updatedAt: 1,
    })),
    messages: [],
  }
  let rejectImage!: (error: Error) => void
  const image = new Promise<StudioData>((_resolve, reject) => {
    rejectImage = reject
  })
  const studio = {
    load: vi.fn(async () => data),
    generateImage: vi.fn(() => image),
    sendChat: vi.fn(async () => data),
    stopChat: vi.fn(),
  }
  vi.stubGlobal('window', { studio })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  render()
  hooks.values[0] = data
  let tree = render()
  find(tree, Composer)!.props.setText('A draft')
  find(tree, SessionSidebar)!.props.onSelect('b')
  tree = render()
  expect(find(tree, Composer)!.props.text).toBe('')
  find(tree, Composer)!.props.setText('B draft')
  find(tree, SessionSidebar)!.props.onSelect('a')
  tree = render()
  expect(find(tree, Composer)!.props.text).toBe('A draft')
  const request = find(tree, Composer)!.props.onSubmit()
  // Even another click before React renders cannot start a duplicate request.
  await find(tree, Composer)!.props.onSubmit()
  expect(studio.generateImage).toHaveBeenCalledTimes(1)
  find(tree, SessionSidebar)!.props.onSelect('b')
  tree = render()
  expect(find(tree, Composer)!.props).toMatchObject({
    text: 'B draft',
    busy: false,
    modelKind: 'chat',
  })
  await find(tree, Composer)!.props.onSubmit()
  expect(studio.sendChat).toHaveBeenCalledWith('b', 'B draft')
  find(tree, SessionSidebar)!.props.onSelect('a')
  tree = render()
  expect(find(tree, Composer)!.props.busy).toBe(true)
  find(tree, Composer)!.props.onStop()
  expect(studio.stopChat).toHaveBeenCalledWith('a')
  find(tree, SessionSidebar)!.props.onSelect('b')
  rejectImage(new Error('A failed'))
  await request
  expect(JSON.stringify(render())).not.toContain('A failed')
  find(render(), SessionSidebar)!.props.onSelect('a')
  expect(JSON.stringify(render())).toContain('A failed')
  expect(find(render(), Composer)!.props.busy).toBe(false)

  data.messages = ['user', 'assistant'].map((role, i) => ({
    id: String(i),
    sessionId: 'a',
    role: role as 'user' | 'assistant',
    kind: 'image',
    content: 'draw',
    imageFiles: [],
    providerName: 'Relay',
    model: 'image',
    createdAt: i,
    status: 'done',
    error: '',
  }))
  hooks.values[0] = data
  studio.generateImage.mockImplementation(async () => data)
  await find(render(), MessageBubble)!.props.onRetry(data.messages[1])
  expect(studio.generateImage).toHaveBeenLastCalledWith('a', 'draw', [])
  expect(studio.sendChat).toHaveBeenCalledTimes(1)
})

it('clears all provider model types in the draft without changing saved data', () => {
  const provider = {
    id: 'relay',
    name: 'Relay',
    baseUrl: 'https://example.com',
    apiKey: 'secret',
    chatModels: ['chat'],
    imageModels: ['image'],
    unknownModels: ['other'],
  }
  const setEditing = vi.fn()
  const props = {
    data: { providers: [], sessions: [], messages: [] } as StudioData,
    page: 'providers' as const,
    setPage: vi.fn(),
    editing: makeEditing(provider),
    setEditing,
    close: vi.fn(),
    refresh: vi.fn(),
    askConfirm: vi.fn(),
  }
  const clearButton = () => {
    hooks.index = 0
    const fieldset = find(SettingsPanel(props), 'fieldset')!
    const row = fieldset.props.children.find(
      (child: any) => child?.props?.className === 'model-fetch-row',
    )
    return row.props.children.find((child: any) => child?.props?.children === 'ui.clearModels')
  }
  expect(clearButton().props.disabled).toBe(false)
  clearButton().props.onClick()
  const cleared = setEditing.mock.calls[0][0]
  expect(cleared).toMatchObject({ ...provider, chatModels: [], imageModels: [], unknownModels: [] })
  expect(provider.chatModels).toEqual(['chat'])
  expect(provider.imageModels).toEqual(['image'])
  expect(provider.unknownModels).toEqual(['other'])
  props.editing = cleared
  expect(clearButton().props.disabled).toBe(true)
})
