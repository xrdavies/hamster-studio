import UpdateNotice from './components/UpdateNotice'
import { t, useLanguage } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { Message, StudioData, StudioSession } from '../shared/types'
import type { ModelKind } from '../shared/model-capabilities'
import SessionTitle from './components/SessionTitle'
import SessionSidebar from './components/SessionSidebar'
import Composer from './components/Composer'
import MessageBubble from './components/MessageBubble'
import { EmptyState, Welcome } from './components/Welcome'
import ConfirmDialog, { type ConfirmState } from './components/ConfirmDialog'
import SettingsPanel, {
  emptyProvider,
  makeEditing,
  type EditingProvider,
} from './components/SettingsPanel'

const newId = () => crypto.randomUUID()

export default function App() {
  const language = useLanguage()
  useEffect(() => {
    void window.studio.setLanguage(language)
  }, [language])
  const [data, setData] = useState<StudioData>({ providers: [], sessions: [], messages: [] })
  const [sessionId, setSessionId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const activeRequests = useRef(new Set<string>())
  const [settings, setSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'general' | 'providers' | 'about'>('general')
  const [editing, setEditing] = useState<EditingProvider | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [toast, setToast] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const refreshVersion = useRef(0)
  const streamed = useRef(new Map<string, Message>())
  const refreshData = async () => {
    const version = ++refreshVersion.current
    const before = new Map(streamed.current)
    const next = await window.studio.load()
    if (version === refreshVersion.current) {
      const messages = new Map(next.messages.map((message) => [message.id, message]))
      for (const [id, message] of streamed.current) {
        if (
          before.get(id) !== message &&
          next.sessions.some((session) => session.id === message.sessionId)
        )
          messages.set(id, message)
      }
      setData({ ...next, messages: [...messages.values()] })
      streamed.current.clear()
    }
    return next
  }
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const previousSession = useRef('')
  const followBottom = useRef(true)
  const [references, setReferences] = useState<Record<string, string>>({})
  const scrollBottom = () => {
    const el = messagesRef.current
    if (el && followBottom.current) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    refreshData()
      .then((next) => {
        setSessionId(next.sessions[0]?.id || '')
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('无法读取本地数据')))
  }, [])
  useEffect(
    () =>
      window.studio.onMessage((message) => {
        streamed.current.set(message.id, message)
        setData((current) => ({
          ...current,
          messages: current.sessions.some((session) => session.id === message.sessionId)
            ? [...current.messages.filter((item) => item.id !== message.id), message]
            : current.messages,
        }))
      }),
    [],
  )
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createSession()
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const session = data.sessions.find((item) => item.id === sessionId) || data.sessions[0]
  const stateId = session?.id || ''
  const text = drafts[stateId] || ''
  const busy =
    pending[stateId] ||
    data.messages.some((m) => m.sessionId === stateId && m.status === 'streaming')
  const error = errors[stateId] || errors[''] || ''
  const setText = (value: string) => setDrafts((current) => ({ ...current, [stateId]: value }))
  const setError = (value: string, id = stateId) =>
    setErrors((current) => ({ ...current, [id]: value }))
  const modelKind = session?.modelKind || 'chat'
  const provider = data.providers.find((item) => item.id === session?.providerId)
  const messages = data.messages
    .filter((item) => item.sessionId === session?.id)
    .sort((a, b) => a.createdAt - b.createdAt)
  const currentModel = modelKind === 'chat' ? session?.chatModel || '' : session?.imageModel || ''
  const visibleSessions = data.sessions.filter((item) => {
    if (!showArchived && item.archived) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return item.title.toLowerCase().includes(query)
  })
  useEffect(() => {
    if (previousSession.current !== session?.id) followBottom.current = true
    previousSession.current = session?.id || ''
    const frame = requestAnimationFrame(scrollBottom)
    return () => cancelAnimationFrame(frame)
  }, [session?.id, messages.length, messages.at(-1)?.content])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? '' : current)), 1800)
  }
  const updateSession = async (values: Partial<StudioSession>) => {
    if (!session) return
    try {
      await window.studio.saveSession({ id: session.id, ...values })
      await refreshData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('保存会话失败'))
    }
  }
  const updateSpecificSession = async (target: StudioSession, values: Partial<StudioSession>) => {
    try {
      await window.studio.saveSession({ id: target.id, ...values })
      await refreshData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('保存会话失败'), target.id)
    }
  }
  async function createSession() {
    const first = data.providers[0]
    if (!first) {
      setSettingsPage('providers')
      setSettings(true)
      setEditing(makeEditing(emptyProvider))
      return
    }
    if (!first.chatModels.length && !first.imageModels.length) {
      setSettingsPage('providers')
      setSettings(true)
      setEditing(makeEditing(first))
      setError(t('请先为 Provider 配置可用模型'))
      return
    }
    const next: StudioSession = {
      id: newId(),
      title: t('新对话'),
      providerId: first.id,
      modelKind: first.chatModels.length ? 'chat' : 'image',
      chatModel: first.chatModels[0] || '',
      imageModel: first.imageModels[0] || '',
      imageProviderId: first.id,
      systemPrompt: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
    }
    await window.studio.saveSession(next)
    await refreshData()
    setSessionId(next.id)
  }
  function askConfirm(title: string, message: string, action: () => void) {
    setConfirm({
      title,
      message,
      confirm: () => {
        setConfirm(null)
        action()
      },
    })
  }
  function deleteSession(target: StudioSession) {
    askConfirm(t('删除会话'), t('会删除这个会话及其全部消息，无法恢复。'), async () => {
      await window.studio.deleteSession(target.id)
      const next = await refreshData()
      setSessionId((current) => (current === target.id ? next.sessions[0]?.id || '' : current))
      setDrafts((current) => {
        const next = { ...current }
        delete next[target.id]
        return next
      })
      setErrors((current) => {
        const next = { ...current }
        delete next[target.id]
        return next
      })
    })
  }
  async function runRequest(target: StudioSession, prompt: string, kind: ModelKind) {
    if (activeRequests.current.has(target.id)) return
    activeRequests.current.add(target.id)
    setPending((current) => ({ ...current, [target.id]: true }))
    setError('', target.id)
    try {
      if (['新对话', 'New conversation'].includes(target.title))
        await window.studio.saveSession({ id: target.id, title: prompt.slice(0, 28) })
      if (kind === 'image') await window.studio.generateImage(target.id, prompt)
      else {
        const reference = references[target.id]
        if (reference) await window.studio.sendChat(target.id, prompt, reference)
        else await window.studio.sendChat(target.id, prompt)
        setReferences((current) => ({ ...current, [target.id]: '' }))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason), target.id)
    } finally {
      activeRequests.current.delete(target.id)
      setPending((current) => ({ ...current, [target.id]: false }))
      await refreshData().catch((reason) =>
        setError(reason instanceof Error ? reason.message : t('无法读取本地数据'), target.id),
      )
    }
  }
  async function submit() {
    if (!session || !text.trim() || activeRequests.current.has(session.id)) return
    const prompt = text.trim()
    setText('')
    await runRequest(session, prompt, modelKind)
  }
  async function retry(message: Message) {
    const target = data.sessions.find((item) => item.id === message.sessionId)
    const history = data.messages
      .filter((item) => item.sessionId === message.sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
    const previous = history[history.findIndex((item) => item.id === message.id) - 1]
    if (message.agent) return
    if (!target || !previous || previous.role !== 'user') return
    await runRequest(target, previous.content, message.kind)
  }
  const changeModel = (providerId: string, model: string, kind: ModelKind) => {
    const next = data.providers.find((item) => item.id === providerId)
    void updateSession({
      providerId,
      modelKind: kind,
      ...(kind === 'chat'
        ? { chatModel: model, imageProviderId: session?.imageProviderId ?? session?.providerId }
        : {
            imageModel: model,
            imageProviderId: providerId,
            chatModel: next?.chatModels[0] || session?.chatModel || '',
          }),
    })
  }

  return (
    <div className="app">
      <SessionSidebar
        data={data}
        session={session}
        search={search}
        setSearch={setSearch}
        searchRef={searchRef}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        visibleSessions={visibleSessions}
        onSelect={(id) => {
          followBottom.current = true
          setSessionId(id)
          requestAnimationFrame(scrollBottom)
        }}
        onDelete={deleteSession}
        onNew={createSession}
        onSettings={() => {
          setSettingsPage('general')
          setSettings(true)
        }}
        onUpdate={updateSpecificSession}
      />
      <main className="main">
        {!session ? (
          <EmptyState
            onSettings={() => {
              setSettingsPage('providers')
              setSettings(true)
              setEditing(makeEditing(emptyProvider))
            }}
          />
        ) : (
          <>
            <header className="topbar">
              <div className="title-block">
                <SessionTitle
                  key={session.id}
                  title={session.title}
                  onSave={(title) => updateSession({ title })}
                />
              </div>
              <div className="local-badge">Local</div>
            </header>
            {!provider && (
              <div className="missing-provider">
                {t('当前会话的 Provider 已删除，历史消息仍保留。请在输入框中选择新的 Provider。')}
              </div>
            )}
            <div
              ref={messagesRef}
              className="messages"
              onScroll={(event) => {
                const el = event.currentTarget
                followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
              }}
              onLoadCapture={scrollBottom}
            >
              {messages.length === 0 ? (
                <Welcome provider={provider} onPrompt={setText} />
              ) : (
                messages.map((item) => (
                  <MessageBubble
                    key={item.id}
                    message={item}
                    onRetry={retry}
                    busy={busy}
                    onReference={(file) => {
                      if (busy) return
                      if (!data.providers.some((p) => p.chatModels.length)) {
                        notify(t('请先选择聊天模型'))
                        return
                      }
                      setReferences((current) => ({ ...current, [session.id]: file }))
                      if (session.modelKind === 'image') {
                        const chat = data.providers.find((p) => p.chatModels.length)
                        if (chat)
                          void updateSession({
                            providerId: chat.id,
                            chatModel: chat.chatModels[0],
                            modelKind: 'chat',
                          })
                      }
                    }}
                    onRegenerate={(prompt) => {
                      setReferences((current) => ({ ...current, [session.id]: '' }))
                      setText(`${t('请重新生成图片：')} ${prompt}`)
                    }}
                    onApprove={async (stepId, allow) => {
                      try {
                        await window.studio.approveImageStep(session.id, stepId, allow)
                      } catch (error) {
                        setError(String(error), session.id)
                      }
                    }}
                    onCopy={() => {
                      navigator.clipboard.writeText(item.content)
                      notify(t('已复制到剪贴板'))
                    }}
                    onExport={async (file) => {
                      try {
                        if (await window.studio.exportImage(file)) notify(t('图片已导出'))
                      } catch (reason) {
                        setError(reason instanceof Error ? reason.message : t('导出图片失败'))
                      }
                    }}
                  />
                ))
              )}
              {error && <div className="error-banner">{t(error)}</div>}
            </div>
            <Composer
              key={session.id}
              providers={data.providers}
              session={session}
              modelKind={modelKind}
              currentModel={currentModel}
              busy={busy}
              text={text}
              setText={setText}
              onModel={changeModel}
              referenceFile={references[session.id]}
              onClearReference={() =>
                setReferences((current) => ({ ...current, [session.id]: '' }))
              }
              onImageModel={async (providerId, model) => {
                await window.studio.saveSession({
                  id: session.id,
                  imageProviderId: providerId,
                  imageModel: model,
                })
                await refreshData()
              }}
              onSubmit={submit}
              onStop={() => void window.studio.stopChat(session.id)}
            />
          </>
        )}
      </main>
      {settings && (
        <SettingsPanel
          data={data}
          page={settingsPage}
          setPage={setSettingsPage}
          editing={editing}
          setEditing={setEditing}
          close={() => {
            setSettings(false)
            setEditing(null)
          }}
          refresh={() => {
            void refreshData().catch((reason) => setError(String(reason)))
          }}
          askConfirm={askConfirm}
        />
      )}
      <UpdateNotice />
      {toast && (
        <div className="toast">
          <Check size={15} />
          {t(toast)}
        </div>
      )}
      {confirm && <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />}
    </div>
  )
}
