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
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'general' | 'providers' | 'about'>('general')
  const [editing, setEditing] = useState<EditingProvider | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const previousSession = useRef('')
  const followBottom = useRef(true)
  const scrollBottom = () => {
    const el = messagesRef.current
    if (el && followBottom.current) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    window.studio
      .load()
      .then((next) => {
        setData(next)
        setSessionId(next.sessions[0]?.id || '')
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('无法读取本地数据')))
  }, [])
  useEffect(
    () =>
      window.studio.onMessage((message) =>
        setData((current) => ({
          ...current,
          messages: [...current.messages.filter((item) => item.id !== message.id), message],
        })),
      ),
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
      setData(await window.studio.saveSession({ ...session, ...values }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('保存会话失败'))
    }
  }
  const updateSpecificSession = async (target: StudioSession, values: Partial<StudioSession>) => {
    try {
      setData(await window.studio.saveSession({ ...target, ...values }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('保存会话失败'))
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
    if (!first.chatModels.length) {
      setSettingsPage('providers')
      setSettings(true)
      setEditing(makeEditing(first))
      setError(t('请先为 Provider 配置聊天模型'))
      return
    }
    const next: StudioSession = {
      id: newId(),
      title: t('新对话'),
      providerId: first.id,
      modelKind: 'chat',
      chatModel: first.chatModels[0],
      imageModel: first.imageModels[0] || '',
      systemPrompt: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      archived: false,
    }
    setData(await window.studio.saveSession(next))
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
      const next = await window.studio.deleteSession(target.id)
      setData(next)
      if (target.id === sessionId) setSessionId(next.sessions[0]?.id || '')
    })
  }
  async function submit() {
    if (!session || !text.trim() || busy) return
    const prompt = text.trim()
    setText('')
    setBusy(true)
    setError('')
    try {
      if (['新对话', 'New conversation'].includes(session.title))
        await updateSession({ title: prompt.slice(0, 28) })
      setData(
        modelKind === 'image'
          ? await window.studio.generateImage(session.id, prompt)
          : await window.studio.sendChat(session.id, prompt),
      )
    } catch (reason) {
      setData(await window.studio.load())
      setError(reason instanceof Error ? reason.message : t('请求失败'))
    } finally {
      setBusy(false)
    }
  }
  async function retry(message: Message) {
    const index = messages.findIndex((item) => item.id === message.id)
    const previous = messages[index - 1]
    if (!previous || previous.role !== 'user') return
    setBusy(true)
    setError('')
    try {
      setData(await window.studio.sendChat(message.sessionId, previous.content))
    } catch (reason) {
      setData(await window.studio.load())
      setError(reason instanceof Error ? reason.message : t('请求失败'))
    } finally {
      setBusy(false)
    }
  }
  const changeModel = (providerId: string, model: string, kind: ModelKind) => {
    const next = data.providers.find((item) => item.id === providerId)
    void updateSession({
      providerId,
      modelKind: kind,
      ...(kind === 'chat'
        ? { chatModel: model, imageModel: next?.imageModels[0] || session?.imageModel || '' }
        : { imageModel: model, chatModel: next?.chatModels[0] || session?.chatModel || '' }),
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
                <div className="subtitle">{t('本地会话 · 不同步到云端')}</div>
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
              providers={data.providers}
              session={session}
              modelKind={modelKind}
              currentModel={currentModel}
              busy={busy}
              text={text}
              setText={setText}
              onModel={changeModel}
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
          refresh={setData}
          askConfirm={askConfirm}
        />
      )}
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
