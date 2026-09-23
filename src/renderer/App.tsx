import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Archive, Check, CheckSquare, Copy, Image as ImageIcon, MessageSquare, MessageSquarePlus,
  PanelLeftClose, Pin, PinOff, Plus, RefreshCw, Search, Send, Settings, Sparkles,
  Square, Trash2, X
} from 'lucide-react'
import type { Message, Provider, ProviderInput, ProviderModels, StudioData, StudioSession } from '../shared/types'

type ModelKind = 'chat' | 'image'
type EditingProvider = ProviderInput & { fetched: ProviderModels; loading: boolean; fetchError: string; testResult: string }
type ConfirmState = { title: string; message: string; confirm: () => void }

const emptyProvider: ProviderInput = { name: '', baseUrl: '', chatModels: [], imageModels: [] }
const newId = () => crypto.randomUUID()
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const imageSrc = (value: string) => value.startsWith('file:') ? value : 'file://' + encodeURI(value)
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]

export default function App() {
  const [data, setData] = useState<StudioData>({ providers: [], sessions: [], messages: [] })
  const [sessionId, setSessionId] = useState('')
  const [text, setText] = useState('')
  const [modelKind, setModelKind] = useState<ModelKind>('chat')
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [editing, setEditing] = useState<EditingProvider | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const previousSession = useRef('')

  useEffect(() => {
    window.studio.load().then(next => { setData(next); setSessionId(next.sessions[0]?.id || '') })
      .catch(reason => setError(reason instanceof Error ? reason.message : '无法读取本地数据'))
  }, [])
  useEffect(() => window.studio.onMessage(message => setData(current => ({
    ...current, messages: [...current.messages.filter(item => item.id !== message.id), message]
  }))), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void createSession() }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const session = data.sessions.find(item => item.id === sessionId) || data.sessions[0]
  const provider = data.providers.find(item => item.id === session?.providerId)
  const canImage = Boolean(provider?.imageModels.length && session?.imageModel)
  const messages = data.messages.filter(item => item.sessionId === session?.id).sort((a, b) => a.createdAt - b.createdAt)
  const currentModel = modelKind === 'chat' ? session?.chatModel || '' : session?.imageModel || ''
  const visibleSessions = data.sessions.filter(item => {
    if (!showArchived && item.archived) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return item.title.toLowerCase().includes(query)
  })
  useEffect(() => { if (!canImage && modelKind === 'image') setModelKind('chat') }, [canImage, modelKind])
  useEffect(() => {
    requestAnimationFrame(() => {
      const element = messagesRef.current
      if (!element) return
      const changed = previousSession.current !== (session?.id || '')
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100
      if (changed || nearBottom) element.scrollTop = element.scrollHeight
      previousSession.current = session?.id || ''
    })
  }, [session?.id, messages.length, messages.at(-1)?.content])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 1800)
  }
  const updateSession = async (values: Partial<StudioSession>) => {
    if (!session) return
    try { setData(await window.studio.saveSession({ ...session, ...values })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存会话失败') }
  }
  const updateSpecificSession = async (target: StudioSession, values: Partial<StudioSession>) => {
    try { setData(await window.studio.saveSession({ ...target, ...values })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存会话失败') }
  }
  async function createSession() {
    const first = data.providers[0]
    if (!first) { setSettings(true); setEditing(makeEditing(emptyProvider)); return }
    if (!first.chatModels.length) { setSettings(true); setEditing(makeEditing(first)); setError('请先为 Provider 配置聊天模型'); return }
    const next: StudioSession = { id: newId(), title: '新对话', providerId: first.id, chatModel: first.chatModels[0], imageModel: first.imageModels[0] || '', systemPrompt: '', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, archived: false }
    setData(await window.studio.saveSession(next)); setSessionId(next.id); setModelKind('chat')
  }
  function askConfirm(title: string, message: string, action: () => void) { setConfirm({ title, message, confirm: () => { setConfirm(null); action() } }) }
  function deleteSession(target: StudioSession) {
    askConfirm('删除会话', '会删除这个会话及其全部消息，无法恢复。', async () => {
      const next = await window.studio.deleteSession(target.id); setData(next)
      if (target.id === sessionId) setSessionId(next.sessions[0]?.id || '')
    })
  }
  async function deleteSelected() {
    const ids = [...selected]
    askConfirm('删除选中的会话', '会删除选中的会话及其全部消息，无法恢复。', async () => {
      let next = data
      for (const id of ids) next = await window.studio.deleteSession(id)
      setData(next); setSelected(new Set()); if (ids.includes(sessionId)) setSessionId(next.sessions[0]?.id || '')
    })
  }
  async function submit() {
    if (!session || !text.trim() || busy) return
    const prompt = text.trim(); setText(''); setBusy(true); setError('')
    try {
      if (session.title === '新对话') await updateSession({ title: prompt.slice(0, 28) })
      setData(modelKind === 'image' ? await window.studio.generateImage(session.id, prompt) : await window.studio.sendChat(session.id, prompt))
    } catch (reason) { setData(await window.studio.load()); setError(reason instanceof Error ? reason.message : '请求失败') }
    finally { setBusy(false) }
  }
  async function retry(message: Message) {
    const index = messages.findIndex(item => item.id === message.id)
    const previous = messages[index - 1]
    if (!previous || previous.role !== 'user') return
    setBusy(true); setError('')
    try { setData(await window.studio.sendChat(message.sessionId, previous.content)) }
    catch (reason) { setData(await window.studio.load()); setError(reason instanceof Error ? reason.message : '请求失败') }
    finally { setBusy(false) }
  }
  const changeProvider = (id: string) => {
    const next = data.providers.find(item => item.id === id)
    if (next) void updateSession({ providerId: id, chatModel: next.chatModels[0] || '', imageModel: next.imageModels[0] || '' })
  }
  const changeModel = (model: string) => void updateSession(modelKind === 'chat' ? { chatModel: model } : { imageModel: model })

  return <div className="app">
    <SessionSidebar data={data} session={session} search={search} setSearch={setSearch} searchRef={searchRef} showArchived={showArchived} setShowArchived={setShowArchived} selected={selected} setSelected={setSelected} visibleSessions={visibleSessions} onSelect={setSessionId} onDelete={deleteSession} onNew={createSession} onSettings={() => setSettings(true)} onDeleteSelected={deleteSelected} onUpdate={updateSpecificSession} />
    <main className="main">
      {!session ? <EmptyState onSettings={() => { setSettings(true); setEditing(makeEditing(emptyProvider)) }} /> : <>
        <header className="topbar"><div className="title-block"><input className="title-input" value={session.title} onChange={event => void updateSession({ title: event.target.value })} /><div className="subtitle">本地会话 · 不同步到云端</div></div><div className="local-badge">Local</div></header>
        {!provider && <div className="missing-provider">当前会话的 Provider 已删除，历史消息仍保留。请在输入框中选择新的 Provider。</div>}
        <div ref={messagesRef} className="messages">{messages.length === 0 ? <Welcome provider={provider} onPrompt={setText} /> : messages.map(item => <MessageBubble key={item.id} message={item} onRetry={retry} onCopy={() => { navigator.clipboard.writeText(item.content); notify('已复制到剪贴板') }} />)}{error && <div className="error-banner">{error}</div>}</div>
        <Composer providers={data.providers} provider={provider} session={session} modelKind={modelKind} canImage={canImage} currentModel={currentModel} busy={busy} text={text} setText={setText} onKind={setModelKind} onProvider={changeProvider} onModel={changeModel} onSubmit={submit} onStop={() => void window.studio.stopChat(session.id)} />
      </>}
    </main>
    {settings && <SettingsPanel data={data} editing={editing} setEditing={setEditing} close={() => { setSettings(false); setEditing(null) }} refresh={setData} askConfirm={askConfirm} />}
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
    {confirm && <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />}
  </div>
}

function makeEditing(input: ProviderInput): EditingProvider { return { ...input, fetched: { chatModels: [], imageModels: [] }, loading: false, fetchError: '', testResult: '' } }

function SessionSidebar({ data, session, search, setSearch, searchRef, showArchived, setShowArchived, selected, setSelected, visibleSessions, onSelect, onDelete, onNew, onSettings, onDeleteSelected, onUpdate }: { data: StudioData; session?: StudioSession; search: string; setSearch: (value: string) => void; searchRef: React.RefObject<HTMLInputElement | null>; showArchived: boolean; setShowArchived: (value: boolean) => void; selected: Set<string>; setSelected: (value: Set<string>) => void; visibleSessions: StudioSession[]; onSelect: (id: string) => void; onDelete: (session: StudioSession) => void; onNew: () => void; onSettings: () => void; onDeleteSelected: () => void; onUpdate: (session: StudioSession, values: Partial<StudioSession>) => Promise<void> }) {
  return <aside className="sidebar"><div className="brand"><div className="brand-mark">H</div><span>Hamster Studio</span><PanelLeftClose size={16} className="muted" /></div><button className="new-chat" onClick={onNew}><MessageSquarePlus size={17} /> 新建对话 <span>⌘ N</span></button><div className="section-label">最近对话</div><div className="search-wrap"><Search size={14} /><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题 · ⌘ F" /></div><div className="session-tools"><button onClick={() => setShowArchived(!showArchived)}>{showArchived ? '隐藏归档' : '显示归档'}</button>{selected.size > 0 && <button className="danger-text" onClick={onDeleteSelected}><Trash2 size={13} /> 删除 {selected.size}</button>}</div><div className="session-list">{visibleSessions.map(item => <div key={item.id} className={item.id === session?.id ? 'session active' : 'session'}><button className="session-main" onClick={() => onSelect(item.id)}><span className="session-copy"><span className="session-title">{item.pinned && <Pin size={11} />}{item.title}</span><span className="session-preview">{data.messages.filter(message => message.sessionId === item.id).at(-1)?.content || '空会话'} · {time(item.updatedAt)}</span></span></button><div className="session-actions"><button title={selected.has(item.id) ? '取消选择' : '选择'} onClick={() => { const next = new Set(selected); next.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelected(next) }}>{selected.has(item.id) ? <CheckSquare size={14} /> : <Square size={14} />}</button><button title={item.pinned ? '取消置顶' : '置顶'} onClick={() => void onUpdate(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button><button title={item.archived ? '取消归档' : '归档'} onClick={() => void onUpdate(item, { archived: !item.archived })}><Archive size={14} /></button><button title="删除" onClick={() => onDelete(item)}><Trash2 size={14} /></button></div></div>)}</div><div className="sidebar-bottom"><button onClick={onSettings}><Settings size={17} /> 设置</button></div></aside>
}

function Composer({ providers, provider, session, modelKind, canImage, currentModel, busy, text, setText, onKind, onProvider, onModel, onSubmit, onStop }: { providers: Provider[]; provider?: Provider; session: StudioSession; modelKind: ModelKind; canImage: boolean; currentModel: string; busy: boolean; text: string; setText: (value: string) => void; onKind: (kind: ModelKind) => void; onProvider: (id: string) => void; onModel: (model: string) => void; onSubmit: () => void; onStop: () => void }) {
  const models = modelKind === 'chat' ? provider?.chatModels || [] : provider?.imageModels || []
  return <div className="composer-wrap"><div className="composer"><div className="composer-modelbar"><select className="provider-select" value={session.providerId} onChange={event => onProvider(event.target.value)}>{!provider && <option value={session.providerId}>Provider 已删除</option>}{providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="kind-tabs"><button type="button" className={modelKind === 'chat' ? 'kind-tab active' : 'kind-tab'} onClick={() => onKind('chat')}><MessageSquare size={14} />聊天</button><button type="button" disabled={!canImage} className={modelKind === 'image' ? 'kind-tab active' : 'kind-tab'} onClick={() => onKind('image')}><ImageIcon size={14} />图片</button></div><div className="model-field"><span className="model-icon">{modelKind === 'chat' ? <MessageSquare size={14} /> : <ImageIcon size={14} />}</span><select value={currentModel} disabled={!provider || !models.length} onChange={event => onModel(event.target.value)}>{!models.length && <option value="">未配置模型</option>}{models.map(model => <option key={model}>{model}</option>)}</select></div></div><div className="composer-input"><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit() } }} placeholder={modelKind === 'image' ? '描述你想生成的图片…' : '给 Hamster Studio 发消息…'} disabled={busy} /><button className="send" onClick={busy ? onStop : onSubmit} disabled={!busy && !text.trim()}>{busy ? <span className="spinner" /> : <Send size={18} />}</button></div><div className="hint">{modelKind === 'image' ? '图片模型：' + (session.imageModel || '未配置') : 'Enter 发送 · Shift + Enter 换行'}</div></div></div>
}

function EmptyState({ onSettings }: { onSettings: () => void }) { return <div className="empty"><div className="empty-icon"><Sparkles /></div><h1>开始使用 Hamster Studio</h1><p>配置一个自定义 OpenAI Compatible 中转站，然后开始聊天或生成图片。</p><button onClick={onSettings}>配置 Provider</button></div> }
function Welcome({ provider, onPrompt }: { provider?: Provider; onPrompt: (prompt: string) => void }) { const suggestions = ['帮我整理一个三步计划', '写一段简洁的产品介绍', '生成一张极简风格海报']; return <div className="welcome"><div className="welcome-icon"><Sparkles size={22} /></div><h2>有什么可以帮你？</h2><p>{provider ? '当前使用 ' + provider.name + '，你的 API Key 只保存在本机。' : '请先配置一个 Provider。'}</p><div className="suggestions">{suggestions.map(item => <button key={item} onClick={() => onPrompt(item)}>{item}</button>)}</div></div> }
function MessageBubble({ message, onRetry, onCopy }: { message: Message; onRetry: (message: Message) => void; onCopy: () => void }) { return <div className={message.role === 'user' ? 'message user' : 'message assistant'}><div className="avatar">{message.role === 'user' ? '你' : 'H'}</div><div className="message-body"><div className="message-meta">{message.role === 'user' ? '你' : message.providerName}<span>{message.model}</span></div>{message.kind === 'image' ? <>{message.content && <p>{message.content}</p>}{message.status === 'streaming' && <div className="image-loading"><span className="spinner dark" />正在生成图片…</div>}{message.error && <div className="image-error">{message.error}</div>}{message.imageFiles.map(file => <img className="generated-image" src={imageSrc(file)} key={file} />)}</> : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.error || '▍')}</ReactMarkdown></div>}{message.role === 'assistant' && <div className="message-actions"><button onClick={onCopy}><Copy size={13} />复制</button><button onClick={() => onRetry(message)}><RefreshCw size={13} />重试</button></div>}</div></div> }

function SettingsPanel({ data, editing, setEditing, close, refresh, askConfirm }: { data: StudioData; editing: EditingProvider | null; setEditing: (value: EditingProvider | null) => void; close: () => void; refresh: (data: StudioData) => void; askConfirm: (title: string, message: string, action: () => void) => void }) {
  const current = editing
  const fetchModels = async () => {
    if (!current) return
    setEditing({ ...current, loading: true, fetchError: '', testResult: '' })
    try { const fetched = await window.studio.fetchModels(current); setEditing({ ...current, fetched, chatModels: unique([...current.chatModels, ...fetched.chatModels]), imageModels: unique([...current.imageModels, ...fetched.imageModels]), loading: false, fetchError: '', testResult: '已更新模型列表' }) }
    catch (reason) { setEditing({ ...current, loading: false, fetchError: reason instanceof Error ? reason.message : '模型拉取失败' }) }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!current) return
    try { await window.studio.saveProvider({ ...current, chatModels: unique(current.chatModels), imageModels: unique(current.imageModels) }); refresh(await window.studio.load()); setEditing(null) }
    catch (reason) { setEditing({ ...current, fetchError: reason instanceof Error ? reason.message : '保存失败' }) }
  }
  const test = async () => {
    if (!current) return
    try { await window.studio.testProvider(current); setEditing({ ...current, testResult: '连接成功', fetchError: '' }) }
    catch (reason) { setEditing({ ...current, testResult: '', fetchError: reason instanceof Error ? reason.message : '连接失败' }) }
  }
  useEffect(() => {
    if (current?.id && !current.loading && !current.fetched.chatModels.length && !current.fetched.imageModels.length) void fetchModels()
  }, [current?.id])
  const remove = () => {
    if (!current?.id) return
    askConfirm('删除 Provider', '删除后原有 Session 和消息会保留，但需要选择新的 Provider 才能继续请求。', async () => { await window.studio.deleteProvider(current.id!); refresh(await window.studio.load()); setEditing(null) })
  }
  return <div className="settings-backdrop" onMouseDown={close}><section className="settings" onMouseDown={event => event.stopPropagation()}>{!current ? <><div className="settings-head"><h2>设置</h2><button onClick={close}><X /></button></div><div className="settings-content"><div className="settings-title"><div><h3>Providers</h3><p>模型列表从 Provider 自动读取，也可以手动补充。</p></div><button onClick={() => setEditing(makeEditing(emptyProvider))}><Plus size={16} />添加</button></div>{data.providers.length === 0 && <div className="settings-empty">还没有 Provider</div>}{data.providers.map(item => <div className="provider-row" key={item.id}><div><strong>{item.name}</strong><small>{item.baseUrl} · {item.hasKey ? '已配置 Key' : '未配置 Key'}</small><div className="capability-chips">{item.chatModels.map(model => <span key={model}><MessageSquare size={11} />{model}</span>)}{item.imageModels.map(model => <span key={model}><ImageIcon size={11} />{model}</span>)}</div></div><button onClick={() => setEditing(makeEditing(item))}>编辑</button></div>)}</div></> : <><div className="settings-head"><h2>{current.id ? '编辑 Provider' : '添加 Provider'}</h2><button onClick={() => setEditing(null)}><X /></button></div><form className="provider-form" onSubmit={save}><label>名称<input required value={current.name} onChange={event => setEditing({ ...current, name: event.target.value })} placeholder="我的中转站" /></label><label>Base URL<input required type="url" value={current.baseUrl} onChange={event => setEditing({ ...current, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label><label>API Key<input type="password" value={current.apiKey || ''} onChange={event => setEditing({ ...current, apiKey: event.target.value })} placeholder={current.id ? '留空则保留原 Key' : 'sk-…'} /></label><div className="model-fetch-row"><span>模型能力</span><button type="button" className="secondary" onClick={fetchModels} disabled={current.loading}>{current.loading ? '拉取中…' : '从 Provider 拉取模型'}</button></div>{current.fetchError && <div className="form-error">{current.fetchError}</div>}{current.testResult && <div className="form-success">{current.testResult}</div>}<label>聊天模型（可补充）<input value={current.chatModels.join(', ')} onChange={event => setEditing({ ...current, chatModels: event.target.value.split(',') })} placeholder="gpt-5.6, gpt-5.5" /></label><div className="capability-chips edit">{current.chatModels.map(model => <span key={model}><MessageSquare size={11} />{model}</span>)}</div><label>图片模型（可补充）<input value={current.imageModels.join(', ')} onChange={event => setEditing({ ...current, imageModels: event.target.value.split(',') })} placeholder="gpt-image-2" /></label><div className="capability-chips edit">{current.imageModels.map(model => <span key={model}><ImageIcon size={11} />{model}</span>)}</div><div className="form-actions"><button type="button" className="secondary" onClick={test}>测试连接</button><button type="submit">保存 Provider</button></div></form>{current.id && <button className="danger-link" onClick={remove}><Trash2 size={14} />删除 Provider</button>}</>}</section></div>
}

function ConfirmDialog({ state, onCancel }: { state: ConfirmState; onCancel: () => void }) { return <div className="confirm-backdrop"><section className="confirm-dialog"><h3>{state.title}</h3><p>{state.message}</p><div><button className="secondary" onClick={onCancel}>取消</button><button className="primary danger" onClick={state.confirm}>确认</button></div></section></div> }
