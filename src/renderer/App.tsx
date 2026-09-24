import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Archive, Check, ChevronDown, Copy, Download, Globe, Image as ImageIcon, Info, Languages,
  MessageSquare, MessageSquarePlus, PanelLeftClose, Pin, PinOff, Plus, RefreshCw, Search,
  Send, Settings, Sparkles, Trash2, X
} from 'lucide-react'
import type { Message, Provider, ProviderInput, ProviderModels, StudioData, StudioSession } from '../shared/types'
import { classifyModels, type ModelKind } from '../shared/model-capabilities'
import hamsterLogo from './assets/hamster-logo-256.png'

type EditingProvider = ProviderInput & { fetched: ProviderModels; loading: boolean; fetchError: string; testResult: string }
type ConfirmState = { title: string; message: string; confirm: () => void }

const emptyProvider: ProviderInput = { name: '', baseUrl: '', chatModels: [], imageModels: [] }
const newId = () => crypto.randomUUID()
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]

export default function App() {
  const [data, setData] = useState<StudioData>({ providers: [], sessions: [], messages: [] })
  const [sessionId, setSessionId] = useState('')
  const [text, setText] = useState('')
  const [modelKind, setModelKind] = useState<ModelKind>('chat')
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
  const scrollBottom = () => { const el = messagesRef.current; if (el && followBottom.current) el.scrollTop = el.scrollHeight }

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
  const messages = data.messages.filter(item => item.sessionId === session?.id).sort((a, b) => a.createdAt - b.createdAt)
  const currentModel = modelKind === 'chat' ? session?.chatModel || '' : session?.imageModel || ''
  const visibleSessions = data.sessions.filter(item => {
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
    if (!first) { setSettingsPage('providers'); setSettings(true); setEditing(makeEditing(emptyProvider)); return }
    if (!first.chatModels.length) { setSettingsPage('providers'); setSettings(true); setEditing(makeEditing(first)); setError('请先为 Provider 配置聊天模型'); return }
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
  const changeModel = (providerId: string, model: string, kind: ModelKind) => {
    const next = data.providers.find(item => item.id === providerId)
    setModelKind(kind)
    void updateSession({
      providerId,
      ...(kind === 'chat' ? { chatModel: model, imageModel: next?.imageModels[0] || session?.imageModel || '' } : { imageModel: model, chatModel: next?.chatModels[0] || session?.chatModel || '' })
    })
  }

  return <div className="app">
    <SessionSidebar data={data} session={session} search={search} setSearch={setSearch} searchRef={searchRef} showArchived={showArchived} setShowArchived={setShowArchived} visibleSessions={visibleSessions} onSelect={id => { followBottom.current = true; setSessionId(id); requestAnimationFrame(scrollBottom) }} onDelete={deleteSession} onNew={createSession} onSettings={() => { setSettingsPage('general'); setSettings(true) }} onUpdate={updateSpecificSession} />
    <main className="main">
      {!session ? <EmptyState onSettings={() => { setSettingsPage('providers'); setSettings(true); setEditing(makeEditing(emptyProvider)) }} /> : <>
        <header className="topbar"><div className="title-block"><input className="title-input" value={session.title} onChange={event => void updateSession({ title: event.target.value })} /><div className="subtitle">本地会话 · 不同步到云端</div></div><div className="local-badge">Local</div></header>
        {!provider && <div className="missing-provider">当前会话的 Provider 已删除，历史消息仍保留。请在输入框中选择新的 Provider。</div>}
        <div ref={messagesRef} className="messages" onScroll={event => { const el = event.currentTarget; followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }} onLoadCapture={scrollBottom}>{messages.length === 0 ? <Welcome provider={provider} onPrompt={setText} /> : messages.map(item => <MessageBubble key={item.id} message={item} onRetry={retry} onCopy={() => { navigator.clipboard.writeText(item.content); notify('已复制到剪贴板') }} onExport={async file => { try { if (await window.studio.exportImage(file)) notify('图片已导出') } catch (reason) { setError(reason instanceof Error ? reason.message : '导出图片失败') } }} />)}{error && <div className="error-banner">{error}</div>}</div>
        <Composer providers={data.providers} session={session} modelKind={modelKind} currentModel={currentModel} busy={busy} text={text} setText={setText} onModel={changeModel} onSubmit={submit} onStop={() => void window.studio.stopChat(session.id)} />
      </>}
    </main>
    {settings && <SettingsPanel data={data} page={settingsPage} setPage={setSettingsPage} editing={editing} setEditing={setEditing} close={() => { setSettings(false); setEditing(null) }} refresh={setData} askConfirm={askConfirm} />}
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
    {confirm && <ConfirmDialog state={confirm} onCancel={() => setConfirm(null)} />}
  </div>
}

function makeEditing(input: ProviderInput): EditingProvider { return { ...input, fetched: { chatModels: [], imageModels: [] }, loading: false, fetchError: '', testResult: '' } }

function SessionSidebar({ data, session, search, setSearch, searchRef, showArchived, setShowArchived, visibleSessions, onSelect, onDelete, onNew, onSettings, onUpdate }: { data: StudioData; session?: StudioSession; search: string; setSearch: (value: string) => void; searchRef: React.RefObject<HTMLInputElement | null>; showArchived: boolean; setShowArchived: (value: boolean) => void; visibleSessions: StudioSession[]; onSelect: (id: string) => void; onDelete: (session: StudioSession) => void; onNew: () => void; onSettings: () => void; onUpdate: (session: StudioSession, values: Partial<StudioSession>) => Promise<void> }) {
  return <aside className="sidebar"><div className="brand"><img src={hamsterLogo} className="brand-image" /><span>Hamster Studio</span><PanelLeftClose size={16} className="muted" /></div><button className="new-chat" onClick={onNew}><MessageSquarePlus size={17} /> 新建对话 <span>⌘ N</span></button><div className="section-label">最近对话</div><div className="search-wrap"><Search size={14} /><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题 · ⌘ F" /></div><div className="session-tools"><button onClick={() => setShowArchived(!showArchived)}>{showArchived ? '隐藏归档' : '显示归档'}</button></div><div className="session-list">{visibleSessions.map(item => <div key={item.id} className={item.id === session?.id ? 'session active' : 'session'}><button className="session-main" onClick={() => onSelect(item.id)}><span className="session-copy"><span className="session-title">{item.pinned && <Pin size={11} />}{item.title}</span><span className="session-preview">{data.messages.filter(message => message.sessionId === item.id).at(-1)?.content || '空会话'} · {time(item.updatedAt)}</span></span></button><div className="session-actions"><button title={item.pinned ? '取消置顶' : '置顶'} onClick={() => void onUpdate(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button><button title={item.archived ? '取消归档' : '归档'} onClick={() => void onUpdate(item, { archived: !item.archived })}><Archive size={14} /></button><button title="删除" onClick={() => onDelete(item)}><Trash2 size={14} /></button></div></div>)}</div><div className="sidebar-bottom"><button onClick={onSettings}><Settings size={17} /> 设置</button></div></aside>
}

type ModelChoice = { providerId: string; providerName: string; model: string; kind: ModelKind }

function Composer({ providers, session, modelKind, currentModel, busy, text, setText, onModel, onSubmit, onStop }: { providers: Provider[]; session: StudioSession; modelKind: ModelKind; currentModel: string; busy: boolean; text: string; setText: (value: string) => void; onModel: (providerId: string, model: string, kind: ModelKind) => void; onSubmit: () => void; onStop: () => void }) {
  const choices = providers.flatMap(provider => [
    ...provider.chatModels.map(model => ({ providerId: provider.id, providerName: provider.name, model, kind: 'chat' as const })),
    ...provider.imageModels.map(model => ({ providerId: provider.id, providerName: provider.name, model, kind: 'image' as const }))
  ])
  const selected = choices.find(choice => choice.providerId === session.providerId && choice.kind === modelKind && choice.model === currentModel)
  return <div className="composer-wrap"><div className="composer"><div className="composer-modelbar"><ModelMenu choices={choices} selected={selected} onSelect={onModel} /></div><div className="composer-input"><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit() } }} placeholder={modelKind === 'image' ? '描述你想生成的图片…' : '给 Hamster Studio 发消息…'} disabled={busy} /><button className="send" onClick={busy ? onStop : onSubmit} disabled={!busy && !text.trim()}>{busy ? <span className="spinner" /> : <Send size={18} />}</button></div><div className="hint">{modelKind === 'image' ? '图片模型：' + (session.imageModel || '未配置') + ' · Enter 发送 · Shift + Enter 换行' : '聊天模型：' + (session.chatModel || '未配置') + ' · Enter 发送 · Shift + Enter 换行'}</div></div></div>
}

function ModelMenu({ choices, selected, onSelect }: { choices: ModelChoice[]; selected?: ModelChoice; onSelect: (providerId: string, model: string, kind: ModelKind) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return <div className="model-menu" ref={menuRef}><button className="model-trigger" type="button" onClick={() => setOpen(!open)} aria-expanded={open}><span>{selected ? `${selected.providerName} · ${selected.model}` : '选择 Provider · 模型'}</span><span className="model-trigger-icon">{selected?.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}<ChevronDown size={14} /></span></button>{open && <div className="model-menu-panel" role="listbox">{choices.length ? choices.map(choice => <button className="model-option" type="button" role="option" aria-selected={choice === selected} key={`${choice.providerId}:${choice.kind}:${choice.model}`} onClick={() => { onSelect(choice.providerId, choice.model, choice.kind); setOpen(false) }}><span>{choice.providerName} · {choice.model}</span>{choice.kind === 'image' ? <ImageIcon size={15} /> : <MessageSquare size={15} />}</button>) : <div className="model-empty">请先在设置中配置模型</div>}</div>}</div>
}

function EmptyState({ onSettings }: { onSettings: () => void }) { return <div className="empty"><div className="empty-icon"><Sparkles /></div><h1>开始使用 Hamster Studio</h1><p>配置一个自定义 OpenAI Compatible 中转站，然后开始聊天或生成图片。</p><button onClick={onSettings}>配置 Provider</button></div> }
function Welcome({ provider, onPrompt }: { provider?: Provider; onPrompt: (prompt: string) => void }) { const suggestions = ['帮我整理一个三步计划', '写一段简洁的产品介绍', '生成一张极简风格海报']; return <div className="welcome"><img src={hamsterLogo} className="welcome-logo" /><h2>有什么可以帮你？</h2><p>{provider ? '当前使用 ' + provider.name + '，你的 API Key 只保存在本机。' : '请先配置一个 Provider。'}</p><div className="suggestions">{suggestions.map(item => <button key={item} onClick={() => onPrompt(item)}>{item}</button>)}</div></div> }
function MessageBubble({ message, onRetry, onCopy, onExport }: { message: Message; onRetry: (message: Message) => void; onCopy: () => void; onExport: (file: string) => Promise<void> }) {
  const [images, setImages] = useState<{ file: string; src: string }[]>([])
  useEffect(() => {
    let cancelled = false
    if (message.kind === 'image') Promise.all(message.imageFiles.map(async file => ({ file, src: await window.studio.readImage(file).catch(() => '') }))).then(values => { if (!cancelled) setImages(values.filter(item => item.src)) })
    return () => { cancelled = true }
  }, [message.id, message.imageFiles.join('|')])
  return <div className={message.role === 'user' ? 'message user' : 'message assistant'}><div className="avatar">{message.role === 'user' ? '你' : 'H'}</div><div className="message-body"><div className="message-meta">{message.role === 'user' ? '你' : message.providerName}<span>{message.model}</span></div>{message.kind === 'image' ? <>{message.content && <p>{message.content}</p>}{message.status === 'streaming' && <div className="image-loading"><span className="spinner dark" />正在生成图片…</div>}{message.error && <div className="image-error">{message.error}</div>}{images.map(image => <div className="generated-image-wrap" key={image.file}><img className="generated-image" src={image.src} /><button className="export-image" onClick={() => void onExport(image.file)}><Download size={13} />导出图片</button></div>)}</> : <>{message.status === 'streaming' && !message.content && <div className="thinking"><span className="spinner dark" />正在思考…</div>}<div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.error || '▍')}</ReactMarkdown></div></>}{message.role === 'assistant' && <div className="message-actions"><button onClick={onCopy}><Copy size={13} />复制</button><button onClick={() => onRetry(message)}><RefreshCw size={13} />重试</button></div>}</div></div>
}

function SettingsPanel({ data, page, setPage, editing, setEditing, close, refresh, askConfirm }: { data: StudioData; page: 'general' | 'providers' | 'about'; setPage: (page: 'general' | 'providers' | 'about') => void; editing: EditingProvider | null; setEditing: (value: EditingProvider | null) => void; close: () => void; refresh: (data: StudioData) => void; askConfirm: (title: string, message: string, action: () => void) => void }) {
  const current = editing
  const [manualModel, setManualModel] = useState('')
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState('尚未检查更新')
  const [checking, setChecking] = useState(false)
  useEffect(() => { window.studio.version().then(setVersion).catch(() => setVersion('未知')) }, [])
  const checkUpdates = async () => {
    setChecking(true)
    try { setUpdateStatus(await window.studio.checkUpdates()) }
    catch (error) { setUpdateStatus(error instanceof Error ? error.message : '检查更新失败') }
    finally { setChecking(false) }
  }
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
  const providerEditor = current && <>
    <div className="settings-head"><h2>{current.id ? '编辑 Provider' : '添加 Provider'}</h2><button onClick={() => setEditing(null)}><X /></button></div>
    <form className="provider-form" onSubmit={save}>
      <label>名称<input required value={current.name} onChange={event => setEditing({ ...current, name: event.target.value })} placeholder="我的中转站" /></label>
      <label>Base URL<input required type="url" value={current.baseUrl} onChange={event => setEditing({ ...current, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
      <label>API Key<input type="password" value={current.apiKey || ''} onChange={event => setEditing({ ...current, apiKey: event.target.value })} placeholder={current.id ? '留空则保留原 Key' : 'sk-…'} /></label>
      <div className="model-fetch-row"><span>模型列表</span><button type="button" className="secondary" onClick={fetchModels} disabled={current.loading}>{current.loading ? '拉取中…' : '从 Provider 拉取模型'}</button></div>
      {current.fetchError && <div className="form-error">{current.fetchError}</div>}{current.testResult && <div className="form-success">{current.testResult}</div>}
      <label>手动补充模型<input value={manualModel} onChange={event => setManualModel(event.target.value)} placeholder="输入模型 ID，多个模型用逗号分隔" /></label>
      <button type="button" className="secondary" disabled={!manualModel.trim()} onClick={() => { const extra = classifyModels(manualModel.split(',')); setEditing({ ...current, chatModels: unique([...current.chatModels, ...extra.chatModels]), imageModels: unique([...current.imageModels, ...extra.imageModels]) }); setManualModel('') }}>添加到模型列表</button>
      <div className="capability-chips edit">{unique([...current.chatModels, ...current.imageModels]).map(model => <span key={model}>{model}</span>)}</div>
      <div className="form-actions"><button type="button" className="secondary" onClick={test}>测试连接</button><button type="submit">保存 Provider</button></div>
    </form>
    {current.id && <button className="danger-link" onClick={remove}><Trash2 size={14} />删除 Provider</button>}
  </>
  const providerList = <>
    <div className="settings-title"><div><h3>Providers</h3><p>模型列表从 Provider 自动读取，也可以手动补充。</p></div><button onClick={() => setEditing(makeEditing(emptyProvider))}><Plus size={16} />添加</button></div>
    {data.providers.length === 0 && <div className="settings-empty">还没有 Provider</div>}
    {data.providers.map(item => <div className="provider-row" key={item.id}><div><strong>{item.name}</strong><small>{item.baseUrl} · {item.hasKey ? '已配置 Key' : '未配置 Key'}</small><div className="capability-chips">{item.chatModels.map(model => <span key={model}><MessageSquare size={11} />{model}</span>)}{item.imageModels.map(model => <span key={model}><ImageIcon size={11} />{model}</span>)}</div></div><button onClick={() => setEditing(makeEditing(item))}>编辑</button></div>)}
  </>
  const content = current ? providerEditor : <>
    <div className="settings-head"><h2>设置</h2><button onClick={close}><X /></button></div>
    <div className="settings-layout"><nav className="settings-nav"><button className={page === 'general' ? 'active' : ''} onClick={() => setPage('general')}><Languages size={16} />通用</button><button className={page === 'providers' ? 'active' : ''} onClick={() => setPage('providers')}><Globe size={16} />Providers</button><button className={page === 'about' ? 'active' : ''} onClick={() => setPage('about')}><Info size={16} />About</button></nav><div className="settings-content">
      {page === 'general' && <><div className="settings-title"><div><h3>通用设置</h3><p>Hamster Studio 的本地使用偏好。</p></div></div><div className="setting-item"><span>语言</span><strong>简体中文</strong></div><div className="setting-item"><span>数据存储</span><strong>仅保存在本机</strong></div></>}
      {page === 'providers' && providerList}
      {page === 'about' && <><div className="settings-title"><div><h3>About Hamster Studio</h3><p>本地优先的聊天与图片生成工具。</p></div></div><div className="about-card"><img src={hamsterLogo} /><div><strong>Hamster Studio</strong><p>版本 {version || '读取中…'}</p><small role="status">{updateStatus}</small><p><button className="secondary" disabled={checking} onClick={checkUpdates}>{checking ? '检查中…' : '检查更新'}</button></p></div></div></>}
    </div></div>
  </>
  return <div className="settings-backdrop" onKeyDown={event => { if (event.key === 'Escape') close() }} onMouseDown={close}><section className="settings" onMouseDown={event => event.stopPropagation()}>{content}</section></div>
}

function ConfirmDialog({ state, onCancel }: { state: ConfirmState; onCancel: () => void }) { return <div className="confirm-backdrop"><section className="confirm-dialog"><h3>{state.title}</h3><p>{state.message}</p><div><button className="secondary" onClick={onCancel}>取消</button><button className="primary danger" onClick={state.confirm}>确认</button></div></section></div> }
