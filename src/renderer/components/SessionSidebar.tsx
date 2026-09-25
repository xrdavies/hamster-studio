import { t } from '../i18n'
import {
  Archive,
  MessageSquarePlus,
  PanelLeftClose,
  Pin,
  PinOff,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import type { StudioData, StudioSession } from '../../shared/types'
import hamsterLogo from '../assets/hamster-logo-256.png'

const time = (value: number) =>
  new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

export default function SessionSidebar({
  data,
  session,
  search,
  setSearch,
  searchRef,
  showArchived,
  setShowArchived,
  visibleSessions,
  onSelect,
  onDelete,
  onNew,
  onSettings,
  onUpdate,
}: {
  data: StudioData
  session?: StudioSession
  search: string
  setSearch: (value: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  showArchived: boolean
  setShowArchived: (value: boolean) => void
  visibleSessions: StudioSession[]
  onSelect: (id: string) => void
  onDelete: (session: StudioSession) => void
  onNew: () => void
  onSettings: () => void
  onUpdate: (session: StudioSession, values: Partial<StudioSession>) => Promise<void>
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={hamsterLogo} className="brand-image" />
        <span>Hamster Studio</span>
        <PanelLeftClose size={16} className="muted" />
      </div>
      <button className="new-chat" onClick={onNew}>
        <MessageSquarePlus size={17} />
        {t('ui.newConversationLabel')}
        <span>⌘ N</span>
      </button>
      <div className="section-label">{t('ui.recentConversations')}</div>
      <div className="search-wrap">
        <Search size={14} />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('ui.searchTitlesF')}
        />
      </div>
      <div className="session-tools">
        <button onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? t('ui.hideArchived') : t('ui.showArchived')}
        </button>
      </div>
      <div className="session-list">
        {visibleSessions.map((item) => (
          <div key={item.id} className={item.id === session?.id ? 'session active' : 'session'}>
            <button className="session-main" onClick={() => onSelect(item.id)}>
              <span className="session-copy">
                <span className="session-title">
                  {item.pinned && <Pin size={11} />}
                  {item.title}
                </span>
                <span className="session-preview">
                  {data.messages.filter((message) => message.sessionId === item.id).at(-1)
                    ?.content || t('ui.emptyConversation')}{' '}
                  · {time(item.updatedAt)}
                </span>
              </span>
            </button>
            <div className="session-actions">
              <button
                title={item.pinned ? t('ui.unpin') : t('ui.pin')}
                onClick={() => void onUpdate(item, { pinned: !item.pinned })}
              >
                {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button
                title={item.archived ? t('ui.unarchive') : t('ui.archive')}
                onClick={() => void onUpdate(item, { archived: !item.archived })}
              >
                <Archive size={14} />
              </button>
              <button title={t('ui.delete')} onClick={() => onDelete(item)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button onClick={onSettings}>
          <Settings size={17} />
          {t('ui.settings')}
        </button>
      </div>
    </aside>
  )
}
