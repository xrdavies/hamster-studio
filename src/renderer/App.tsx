import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Image, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Plus, Send, Settings, Sparkles, Trash2, X } from 'lucide-react'
import type { Message, Provider, ProviderInput, StudioData, StudioSession } from '../shared/types'

const emptyInput: ProviderInput = { name: '', baseUrl: '', chatModels: [], imageModels: [] }
const newId = () => crypto.randomUUID()

export default function App() {
  const [data, setData] = useState<StudioData>({ providers: [], sessions: [], messages: [] })
  const [sessionId, setSessionId] = useState('')
  const [text, setText] = useState('')
  const [imageMode, setImageMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [editing, setEditing] = useState<ProviderInput | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { window.studio.load().then(next => { setData(next); setSessionId(next.sessions[0]?.id || '') }) }, [])
  useEffect(() => window.studio.onMessage(message => setData(current => ({ ...current, messages: [...current.messages.filter(item => item.id !== message.id), message] }))), [])
  const session = data.sessions.find(item => item.id === sessionId) || data.sessions[0]
  const provider = data.providers.find(item => item.id === session?.providerId)
  const messages = data.messages.filter(item => item.sessionId === session?.id).sort((a, b) => a.createdAt - b.createdAt)

  async function createSession() {
    const p = data.providers[0]
    if (!p) { setSettings(true); setEditing({ ...emptyInput }); return }
    const next: StudioSession = { id: newId(), title: '新对话', providerId: p.id, chatModel: p.chatModels[0] || '', imageModel: p.imageModels[0] || '', systemPrompt: '', createdAt: Date.now(), updatedAt: Date.now() }
    const nextData = await window.studio.saveSession(next); setData(nextData); setSessionId(next.id)
  }
  async function updateSession(values: Partial<StudioSession>) {
    if (!session) return
    setData(await window.studio.saveSession({ ...session, ...values }))
  }
  async function deleteSession(target: StudioSession) {
    const next = await window.studio.deleteSession(target.id)
    setData(next)
    if (target.id === sessionId) setSessionId(next.sessions[0]?.id || '')
  }
  async function submit() {
    if (!session || !text.trim() || busy) return
    const prompt = text.trim(); setText(''); setBusy(true); setError('')
    try { setData(imageMode ? await window.studio.generateImage(session.id, prompt) : await window.studio.sendChat(session.id, prompt)) }
    catch (e) { setError(e instanceof Error ? e.message : '请求失败') }
    finally { setBusy(false) }
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">H</div><span>Hamster Studio</span><PanelLeftClose size={16} className="muted" /></div>
      <button className="new-chat" onClick={createSession}><MessageSquarePlus size={17} /> 新建对话 <span>⌘ N</span></button>
      <div className="section-label">最近对话</div>
      <div className="session-list">{data.sessions.map(item => <button key={item.id} className={item.id === session?.id ? 'session active' : 'session'} onClick={() => setSessionId(item.id)}><span>{item.title}</span><span className="session-actions"><MoreHorizontal size={15} /><Trash2 size={14} onClick={e => { e.stopPropagation(); deleteSession(item) }} /></span></button>)}</div>
      <div className="sidebar-bottom"><button onClick={() => setSettings(true)}><Settings size={17} /> 设置</button></div>
    </aside>
    <main className="main">
      {!session ? <EmptyState onSettings={() => { setSettings(true); setEditing({ ...emptyInput }) }} /> : <>
        <header className="topbar">
          <div><input className="title-input" value={session.title} onChange={e => updateSession({ title: e.target.value })} /><div className="subtitle">本地会话 · 不同步到云端</div></div>
          <div className="selectors">
            <select value={session.providerId} onChange={e => { const p = data.providers.find(item => item.id === e.target.value); updateSession({ providerId: e.target.value, chatModel: p?.chatModels[0] || '', imageModel: p?.imageModels[0] || '' }) }}>{data.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select value={session.chatModel} onChange={e => updateSession({ chatModel: e.target.value })}>{(provider?.chatModels || []).map(model => <option key={model}>{model}</option>)}</select>
            {(provider?.imageModels || []).length > 0 && <select value={session.imageModel} onChange={e => updateSession({ imageModel: e.target.value })}>{provider?.imageModels.map(model => <option key={model}>{model}</option>)}</select>}
          </div>
        </header>
        <div className="messages">{messages.length === 0 ? <Welcome provider={provider} /> : messages.map(item => <MessageBubble key={item.id} message={item} />)}{error && <div className="error-banner">{error}</div>}</div>
        <div className="composer-wrap"><div className="composer">
          <button className={imageMode ? 'mode active' : 'mode'} onClick={() => setImageMode(!imageMode)} title="图片生成"><Image size={18} /></button>
          <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} placeholder={imageMode ? '描述你想生成的图片…' : '给 Hamster Studio 发消息…'} disabled={busy} />
          <button className="send" onClick={submit} disabled={busy || !text.trim()}>{busy ? <span className="spinner" /> : <Send size={18} />}</button>
        </div><div className="hint">{imageMode ? '图片模型：' + (session.imageModel || '未配置') : 'Enter 发送 · Shift + Enter 换行'}</div></div>
      </>}
    </main>
    {settings && <SettingsPanel data={data} editing={editing} setEditing={setEditing} close={() => { setSettings(false); setEditing(null) }} refresh={setData} />}
  </div>
}

function EmptyState({ onSettings }: { onSettings: () => void }) { return <div className="empty"><div className="empty-icon"><Sparkles /></div><h1>开始使用 Hamster Studio</h1><p>配置一个自定义 OpenAI Compatible 中转站，然后开始聊天或生成图片。</p><button onClick={onSettings}>配置 Provider</button></div> }
function Welcome({ provider }: { provider?: Provider }) { return <div className="welcome"><div className="welcome-icon"><Sparkles size={22} /></div><h2>有什么可以帮你？</h2><p>{provider ? '当前使用 ' + provider.name + '，你的 API Key 只保存在本机。' : '请先配置一个 Provider。'}</p></div> }
function MessageBubble({ message }: { message: Message }) { return <div className={message.role === 'user' ? 'message user' : 'message assistant'}><div className="avatar">{message.role === 'user' ? '你' : 'H'}</div><div className="message-body"><div className="message-meta">{message.role === 'user' ? '你' : message.providerName}<span>{message.model}</span></div>{message.kind === 'image' ? <><p>{message.content}</p>{message.imageFiles.map(file => <img className="generated-image" src={'file://' + file} key={file} />)}</> : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '▍'}</ReactMarkdown></div>}</div></div> }

function SettingsPanel({ data, editing, setEditing, close, refresh }: { data: StudioData; editing: ProviderInput | null; setEditing: (value: ProviderInput | null) => void; close: () => void; refresh: (data: StudioData) => void }) {
  const current = editing
  const models = useMemo(() => current?.chatModels.join(', ') || '', [current])
  if (!current) return <div className="settings-backdrop"><section className="settings"><div className="settings-head"><h2>设置</h2><button onClick={close}><X /></button></div><div className="settings-content"><div className="settings-title"><div><h3>Providers</h3><p>使用自定义 OpenAI Compatible 中转站。</p></div><button onClick={() => setEditing({ ...emptyInput })}><Plus size={16} /> 添加</button></div>{data.providers.length === 0 && <div className="settings-empty">还没有 Provider</div>}{data.providers.map(p => <div className="provider-row" key={p.id}><div><strong>{p.name}</strong><small>{p.baseUrl} · {p.hasKey ? '已配置 Key' : '未配置 Key'}</small></div><button onClick={() => setEditing({ ...p })}>编辑</button></div>)}</div></section></div>
  return <div className="settings-backdrop"><section className="settings"><div className="settings-head"><h2>{current.id ? '编辑 Provider' : '添加 Provider'}</h2><button onClick={() => setEditing(null)}><X /></button></div><form className="provider-form" onSubmit={async e => { e.preventDefault(); await window.studio.saveProvider({ ...current, chatModels: models.split(',').map(x => x.trim()).filter(Boolean), imageModels: (current.imageModels || []).filter(Boolean) }); refresh(await window.studio.load()); setEditing(null) }}><label>名称<input required value={current.name} onChange={e => setEditing({ ...current, name: e.target.value })} placeholder="我的中转站" /></label><label>Base URL<input required value={current.baseUrl} onChange={e => setEditing({ ...current, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></label><label>API Key<input type="password" value={current.apiKey || ''} onChange={e => setEditing({ ...current, apiKey: e.target.value })} placeholder={current.id ? '留空则保留原 Key' : 'sk-…'} /></label><label>聊天模型<input required value={models} onChange={e => setEditing({ ...current, chatModels: e.target.value.split(',').map(x => x.trim()) })} placeholder="gpt-5.6" /><small>多个模型使用英文逗号分隔。</small></label><label>图片模型<input value={(current.imageModels || []).join(', ')} onChange={e => setEditing({ ...current, imageModels: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="image2" /></label><div className="form-actions"><button type="button" className="secondary" onClick={async () => { try { await window.studio.testProvider(current); alert('连接成功') } catch (e) { alert(e instanceof Error ? e.message : '连接失败') } }}>测试连接</button><button type="submit">保存 Provider</button></div></form>{current.id && <button className="danger-link" onClick={async () => { await window.studio.deleteProvider(current.id!); refresh(await window.studio.load()); setEditing(null) }}><Trash2 size={14} /> 删除 Provider</button>}</section></div>
}
