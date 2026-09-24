import { useEffect, useState } from 'react'
import {
  Globe,
  Image as ImageIcon,
  Info,
  Languages,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import type { ProviderInput, ProviderModels, StudioData } from '../../shared/types'
import { classifyModels } from '../../shared/model-capabilities'
import { aboutLinks } from '../../shared/about'
import hamsterLogo from '../assets/hamster-logo-256.png'

export type EditingProvider = ProviderInput & {
  fetched: ProviderModels
  loading: boolean
  fetchError: string
  testResult: string
}

export const emptyProvider: ProviderInput = {
  name: '',
  baseUrl: '',
  chatModels: [],
  imageModels: [],
}
const unique = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
]
export function makeEditing(input: ProviderInput): EditingProvider {
  return {
    ...input,
    fetched: { chatModels: [], imageModels: [] },
    loading: false,
    fetchError: '',
    testResult: '',
  }
}
export default function SettingsPanel({
  data,
  page,
  setPage,
  editing,
  setEditing,
  close,
  refresh,
  askConfirm,
}: {
  data: StudioData
  page: 'general' | 'providers' | 'about'
  setPage: (page: 'general' | 'providers' | 'about') => void
  editing: EditingProvider | null
  setEditing: (value: EditingProvider | null) => void
  close: () => void
  refresh: (data: StudioData) => void
  askConfirm: (title: string, message: string, action: () => void) => void
}) {
  const current = editing
  const [manualModel, setManualModel] = useState('')
  const [linkError, setLinkError] = useState('')
  const openLink = async (key: keyof typeof aboutLinks) => {
    setLinkError('')
    try {
      await window.studio.openAboutLink(key)
    } catch {
      setLinkError('无法打开浏览器，请稍后重试。')
    }
  }
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState('尚未检查更新')
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    window.studio
      .version()
      .then(setVersion)
      .catch(() => setVersion('未知'))
  }, [])
  const checkUpdates = async () => {
    setChecking(true)
    try {
      setUpdateStatus(await window.studio.checkUpdates())
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : '检查更新失败')
    } finally {
      setChecking(false)
    }
  }
  const fetchModels = async () => {
    if (!current) return
    setEditing({ ...current, loading: true, fetchError: '', testResult: '' })
    try {
      const fetched = await window.studio.fetchModels(current)
      setEditing({
        ...current,
        fetched,
        chatModels: unique([...current.chatModels, ...fetched.chatModels]),
        imageModels: unique([...current.imageModels, ...fetched.imageModels]),
        loading: false,
        fetchError: '',
        testResult: '已更新模型列表',
      })
    } catch (reason) {
      setEditing({
        ...current,
        loading: false,
        fetchError: reason instanceof Error ? reason.message : '模型拉取失败',
      })
    }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!current) return
    try {
      await window.studio.saveProvider({
        ...current,
        chatModels: unique(current.chatModels),
        imageModels: unique(current.imageModels),
      })
      refresh(await window.studio.load())
      setEditing(null)
    } catch (reason) {
      setEditing({ ...current, fetchError: reason instanceof Error ? reason.message : '保存失败' })
    }
  }
  const test = async () => {
    if (!current) return
    try {
      await window.studio.testProvider(current)
      setEditing({ ...current, testResult: '连接成功', fetchError: '' })
    } catch (reason) {
      setEditing({
        ...current,
        testResult: '',
        fetchError: reason instanceof Error ? reason.message : '连接失败',
      })
    }
  }
  useEffect(() => {
    if (
      current?.id &&
      !current.loading &&
      !current.fetched.chatModels.length &&
      !current.fetched.imageModels.length
    )
      void fetchModels()
  }, [current?.id])
  const remove = () => {
    if (!current?.id) return
    askConfirm(
      '删除 Provider',
      '删除后原有 Session 和消息会保留，但需要选择新的 Provider 才能继续请求。',
      async () => {
        await window.studio.deleteProvider(current.id!)
        refresh(await window.studio.load())
        setEditing(null)
      },
    )
  }
  const providerEditor = current && (
    <>
      <div className="settings-head">
        <h2>{current.id ? '编辑 Provider' : '添加 Provider'}</h2>
        <button onClick={() => setEditing(null)}>
          <X />
        </button>
      </div>
      <form className="provider-form" onSubmit={save}>
        <label>
          名称
          <input
            required
            value={current.name}
            onChange={(event) => setEditing({ ...current, name: event.target.value })}
            placeholder="我的中转站"
          />
        </label>
        <label>
          Base URL
          <input
            required
            type="url"
            value={current.baseUrl}
            onChange={(event) => setEditing({ ...current, baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={current.apiKey || ''}
            onChange={(event) => setEditing({ ...current, apiKey: event.target.value })}
            placeholder={current.id ? '留空则保留原 Key' : 'sk-…'}
          />
        </label>
        <div className="model-fetch-row">
          <span>模型列表</span>
          <button
            type="button"
            className="secondary"
            onClick={fetchModels}
            disabled={current.loading}
          >
            {current.loading ? '拉取中…' : '从 Provider 拉取模型'}
          </button>
        </div>
        {current.fetchError && <div className="form-error">{current.fetchError}</div>}
        {current.testResult && <div className="form-success">{current.testResult}</div>}
        <label>
          手动补充模型
          <input
            value={manualModel}
            onChange={(event) => setManualModel(event.target.value)}
            placeholder="输入模型 ID，多个模型用逗号分隔"
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!manualModel.trim()}
          onClick={() => {
            const extra = classifyModels(manualModel.split(','))
            setEditing({
              ...current,
              chatModels: unique([...current.chatModels, ...extra.chatModels]),
              imageModels: unique([...current.imageModels, ...extra.imageModels]),
            })
            setManualModel('')
          }}
        >
          添加到模型列表
        </button>
        <div className="capability-chips edit">
          {unique([...current.chatModels, ...current.imageModels]).map((model) => (
            <span key={model}>{model}</span>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={test}>
            测试连接
          </button>
          <button type="submit">保存 Provider</button>
        </div>
      </form>
      {current.id && (
        <button className="danger-link" onClick={remove}>
          <Trash2 size={14} />
          删除 Provider
        </button>
      )}
    </>
  )
  const providerList = (
    <>
      <div className="settings-title">
        <div>
          <h3>Providers</h3>
          <p>模型列表从 Provider 自动读取，也可以手动补充。</p>
        </div>
        <button onClick={() => setEditing(makeEditing(emptyProvider))}>
          <Plus size={16} />
          添加
        </button>
      </div>
      {data.providers.length === 0 && <div className="settings-empty">还没有 Provider</div>}
      {data.providers.map((item) => (
        <div className="provider-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <small>
              {item.baseUrl} · {item.hasKey ? '已配置 Key' : '未配置 Key'}
            </small>
            <div className="capability-chips">
              {item.chatModels.map((model) => (
                <span key={model}>
                  <MessageSquare size={11} />
                  {model}
                </span>
              ))}
              {item.imageModels.map((model) => (
                <span key={model}>
                  <ImageIcon size={11} />
                  {model}
                </span>
              ))}
            </div>
          </div>
          <button onClick={() => setEditing(makeEditing(item))}>编辑</button>
        </div>
      ))}
    </>
  )
  const content = current ? (
    providerEditor
  ) : (
    <>
      <div className="settings-head">
        <h2>设置</h2>
        <button onClick={close}>
          <X />
        </button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className={page === 'general' ? 'active' : ''} onClick={() => setPage('general')}>
            <Languages size={16} />
            通用
          </button>
          <button
            className={page === 'providers' ? 'active' : ''}
            onClick={() => setPage('providers')}
          >
            <Globe size={16} />
            Providers
          </button>
          <button className={page === 'about' ? 'active' : ''} onClick={() => setPage('about')}>
            <Info size={16} />
            About
          </button>
        </nav>
        <div className="settings-content">
          {page === 'general' && (
            <>
              <div className="settings-title">
                <div>
                  <h3>通用设置</h3>
                  <p>Hamster Studio 的本地使用偏好。</p>
                </div>
              </div>
              <div className="setting-item">
                <span>语言</span>
                <strong>简体中文</strong>
              </div>
              <div className="setting-item">
                <span>数据存储</span>
                <strong>仅保存在本机</strong>
              </div>
            </>
          )}
          {page === 'providers' && providerList}
          {page === 'about' && (
            <section className="about-page" aria-label="关于 Hamster Studio">
              <img className="about-logo" src={hamsterLogo} alt="Hamster Studio Logo" />
              <h2>Hamster Studio</h2>
              <span className="about-version">版本 {version || '读取中…'}</span>
              <p className="about-intro">一款开源的桌面 AI 聊天与图片生成工具。</p>
              <p className="about-description">
                支持接入自定义 OpenAI Compatible 服务，通过 API Key
                使用模型，无需注册登录。会话历史保存在本机，生成请求直接发送到你配置的服务。
              </p>
              <div className="about-links">
                {(
                  [
                    ['repository', 'GitHub 仓库'],
                    ['issues', '问题反馈'],
                    ['releases', '更新日志'],
                  ] as const
                ).map(([key, label]) => (
                  <a
                    key={key}
                    href={aboutLinks[key]}
                    onClick={(event) => {
                      event.preventDefault()
                      void openLink(key)
                    }}
                  >
                    {label} ↗
                  </a>
                ))}
              </div>
              {linkError && (
                <p role="alert" className="form-error">
                  {linkError}
                </p>
              )}
              <div className="about-update">
                <button className="secondary" disabled={checking} onClick={checkUpdates}>
                  {checking ? '检查中…' : '检查更新'}
                </button>
                <p role="status">{updateStatus}</p>
              </div>
              <footer className="about-footer">
                Made by{' '}
                <a
                  href={aboutLinks.author}
                  onClick={(event) => {
                    event.preventDefault()
                    void openLink('author')
                  }}
                >
                  Frozen · X ↗
                </a>
                <p>许可证：ISC（项目声明）</p>
                <details>
                  <summary>开源致谢</summary>
                  <p>
                    感谢 Electron、React、Vite、Lucide、better-sqlite3、react-markdown
                    和其他开源项目。
                  </p>
                  <p>各依赖遵循其各自的许可证。</p>
                </details>
              </footer>
            </section>
          )}
        </div>
      </div>
    </>
  )
  return (
    <div
      className="settings-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
      onMouseDown={close}
    >
      <section className="settings" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
  )
}
