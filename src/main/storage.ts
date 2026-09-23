import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Message, Provider, ProviderInput, StudioData, StudioSession } from '../shared/types'

type ProviderRow = Omit<Provider, 'chatModels' | 'imageModels' | 'hasKey'> & {
  chatModels: string
  imageModels: string
  apiKey: Buffer | null
}

export class Store {
  private db: Database.Database
  constructor(path: string, private encrypt: (key: string) => Buffer, private decrypt: (key: Buffer) => string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, baseUrl TEXT NOT NULL,
        chatModels TEXT NOT NULL, imageModels TEXT NOT NULL, apiKey BLOB
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, providerId TEXT NOT NULL,
        chatModel TEXT NOT NULL, imageModel TEXT NOT NULL, systemPrompt TEXT NOT NULL,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, imageFiles TEXT NOT NULL,
        providerName TEXT NOT NULL, model TEXT NOT NULL, createdAt INTEGER NOT NULL,
        status TEXT NOT NULL, error TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_session ON messages(sessionId, createdAt);
    `)
    this.db.prepare("UPDATE messages SET status = 'error', error = '上次生成中断' WHERE status = 'streaming'").run()
  }

  close() { this.db.close() }

  data(): StudioData {
    const providers = (this.db.prepare('SELECT * FROM providers ORDER BY rowid').all() as ProviderRow[]).map(({ apiKey, ...row }) => ({
      ...row, chatModels: JSON.parse(row.chatModels), imageModels: JSON.parse(row.imageModels), hasKey: !!apiKey
    }))
    const sessions = this.db.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC') .all() as StudioSession[]
    const messages = (this.db.prepare('SELECT * FROM messages ORDER BY createdAt, rowid').all() as (Omit<Message, 'imageFiles'> & { imageFiles: string })[])
      .map(row => ({ ...row, imageFiles: JSON.parse(row.imageFiles) }))
    return { providers, sessions, messages }
  }

  saveProvider(input: ProviderInput): string {
    const id = input.id || randomUUID()
    const existing = this.db.prepare('SELECT apiKey FROM providers WHERE id = ?').get(id) as { apiKey: Buffer | null } | undefined
    const key = input.apiKey?.trim() ? this.encrypt(input.apiKey.trim()) : existing?.apiKey || null
    this.db.prepare(`INSERT INTO providers (id,name,baseUrl,chatModels,imageModels,apiKey)
      VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,baseUrl=excluded.baseUrl,chatModels=excluded.chatModels,
      imageModels=excluded.imageModels,apiKey=excluded.apiKey`).run(
      id, input.name.trim(), input.baseUrl.trim().replace(/\/+$/, ''),
      JSON.stringify(input.chatModels), JSON.stringify(input.imageModels), key
    )
    return id
  }

  providerKey(id: string): string {
    const row = this.db.prepare('SELECT apiKey FROM providers WHERE id = ?').get(id) as { apiKey: Buffer | null } | undefined
    if (!row) throw new Error('Provider 不存在')
    return row.apiKey ? this.decrypt(row.apiKey) : ''
  }

  deleteProvider(id: string) {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }

  saveSession(input: Partial<StudioSession> & Pick<StudioSession, 'providerId' | 'chatModel'>): string {
    const id = input.id || randomUUID()
    const now = Date.now()
    const existing = this.db.prepare('SELECT createdAt FROM sessions WHERE id = ?').get(id) as { createdAt: number } | undefined
    this.db.prepare(`INSERT INTO sessions (id,title,providerId,chatModel,imageModel,systemPrompt,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,providerId=excluded.providerId,chatModel=excluded.chatModel,
      imageModel=excluded.imageModel,systemPrompt=excluded.systemPrompt,updatedAt=excluded.updatedAt`).run(
      id, input.title || '新对话', input.providerId, input.chatModel,
      input.imageModel || '', input.systemPrompt || '', existing?.createdAt || now, now
    )
    return id
  }

  deleteSession(id: string) { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id) }

  saveMessage(message: Message) {
    this.db.prepare(`INSERT INTO messages (id,sessionId,role,kind,content,imageFiles,providerName,model,createdAt,status,error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,imageFiles=excluded.imageFiles,status=excluded.status,error=excluded.error`).run(
      message.id, message.sessionId, message.role, message.kind, message.content,
      JSON.stringify(message.imageFiles), message.providerName, message.model,
      message.createdAt, message.status, message.error
    )
    this.db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(Date.now(), message.sessionId)
  }

  session(id: string): StudioSession {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as StudioSession | undefined
    if (!row) throw new Error('会话不存在')
    return row
  }

  provider(id: string): Provider {
    const row = (this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined)
    if (!row) throw new Error('Provider 不存在')
    return { id: row.id, name: row.name, baseUrl: row.baseUrl, chatModels: JSON.parse(row.chatModels), imageModels: JSON.parse(row.imageModels), hasKey: !!row.apiKey }
  }

  history(sessionId: string): Message[] {
    return this.data().messages.filter(message => message.sessionId === sessionId && message.kind === 'chat' && message.status === 'done')
  }

  failStreaming(sessionId: string, error: string) {
    this.db.prepare("UPDATE messages SET status = 'error', error = ? WHERE sessionId = ? AND status = 'streaming'").run(error, sessionId)
  }
}
