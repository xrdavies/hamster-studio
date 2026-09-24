import { bundledCatalog, modelKind, type ModelCatalog } from '../shared/model-capabilities'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Message, Provider, ProviderInput, StudioData, StudioSession } from '../shared/types'

type ProviderRow = Omit<Provider, 'chatModels' | 'imageModels' | 'unknownModels' | 'hasKey'> & {
  chatModels: string
  imageModels: string
  unknownModels: string
  apiKey: Buffer | null
}
const normalizeImageModel = (model: string) =>
  model === 'image2' || model === 'image-2' || model === 'gpt-gpt-image-2' ? 'gpt-image-2' : model

export class Store {
  private db: Database.Database
  constructor(
    path: string,
    private encrypt: (key: string) => Buffer,
    private decrypt: (key: Buffer) => string,
    private catalog: () => ModelCatalog = () => bundledCatalog,
  ) {
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
    if (
      !(this.db.pragma('table_info(providers)') as { name: string }[]).some(
        (column) => column.name === 'unknownModels',
      )
    )
      this.db.exec("ALTER TABLE providers ADD COLUMN unknownModels TEXT NOT NULL DEFAULT '[]'")
    for (const column of ['pinned', 'archived']) {
      try {
        this.db.exec('ALTER TABLE sessions ADD COLUMN ' + column + ' INTEGER NOT NULL DEFAULT 0')
      } catch {}
    }
    const columns = this.db.pragma('table_info(sessions)') as { name: string }[]
    if (!columns.some((column) => column.name === 'modelKind')) {
      this.db.transaction(() => {
        this.db.exec("ALTER TABLE sessions ADD COLUMN modelKind TEXT NOT NULL DEFAULT 'chat'")
        this.db.exec(`
          UPDATE sessions SET modelKind = COALESCE(
            (SELECT kind FROM messages WHERE sessionId = sessions.id
             ORDER BY createdAt DESC, rowid DESC LIMIT 1), 'chat'
          )
        `)
      })()
    }
    this.db
      .prepare(
        "UPDATE messages SET status = 'error', error = '上次生成中断' WHERE status = 'streaming'",
      )
      .run()
    this.db
      .prepare(
        `UPDATE providers SET imageModels = REPLACE(REPLACE(REPLACE(imageModels, '"gpt-gpt-image-2"', '"gpt-image-2"'), '"image-2"', '"gpt-image-2"'), '"image2"', '"gpt-image-2"')`,
      )
      .run()
    this.db
      .prepare(
        "UPDATE sessions SET imageModel = 'gpt-image-2' WHERE imageModel IN ('image2', 'image-2', 'gpt-gpt-image-2')",
      )
      .run()
  }

  close() {
    this.db.close()
  }

  data(): StudioData {
    const providers = (
      this.db.prepare('SELECT * FROM providers ORDER BY rowid').all() as ProviderRow[]
    ).map(({ apiKey, ...row }) => ({
      ...row,
      chatModels: JSON.parse(row.chatModels),
      imageModels: JSON.parse(row.imageModels),
      unknownModels: JSON.parse(row.unknownModels),
      hasKey: !!apiKey,
    }))
    for (const provider of providers) {
      const models = {
        chatModels: [] as string[],
        imageModels: [] as string[],
        unknownModels: [] as string[],
      }
      for (const id of new Set([
        ...provider.chatModels,
        ...provider.imageModels,
        ...provider.unknownModels,
      ])) {
        const hint = provider.imageModels.includes(id)
          ? 'image'
          : provider.chatModels.includes(id)
            ? 'chat'
            : undefined
        const kind = modelKind(id, this.catalog(), hint)
        ;(kind === 'image'
          ? models.imageModels
          : kind === 'chat'
            ? models.chatModels
            : models.unknownModels
        ).push(id)
      }
      Object.assign(provider, models)
    }
    const sessions = (
      this.db.prepare('SELECT * FROM sessions ORDER BY pinned DESC, updatedAt DESC').all() as (Omit<
        StudioSession,
        'pinned' | 'archived'
      > & { pinned: number; archived: number })[]
    ).map((session) => ({
      ...session,
      pinned: Boolean(session.pinned),
      archived: Boolean(session.archived),
    }))
    const messages = (
      this.db.prepare('SELECT * FROM messages ORDER BY createdAt, rowid').all() as (Omit<
        Message,
        'imageFiles'
      > & { imageFiles: string })[]
    ).map((row) => ({ ...row, imageFiles: JSON.parse(row.imageFiles) }))
    return { providers, sessions, messages }
  }

  saveProvider(input: ProviderInput): string {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const baseUrl =
      typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : ''
    const chatModels = Array.isArray(input.chatModels)
      ? input.chatModels
          .filter((model): model is string => typeof model === 'string')
          .map((model) => model.trim())
          .filter(Boolean)
      : []
    const imageModels = Array.isArray(input.imageModels)
      ? input.imageModels
          .filter((model): model is string => typeof model === 'string')
          .map(normalizeImageModel)
          .map((model) => model.trim())
          .filter(Boolean)
      : []
    const unknownModels = [
      ...new Set(
        (input.unknownModels || [])
          .filter((id) => typeof id === 'string' && id.trim())
          .map((id) => id.trim()),
      ),
    ].filter((id) => !chatModels.includes(id) && !imageModels.includes(id))
    if (!name) throw new Error('Provider 名称不能为空')
    if (!baseUrl) throw new Error('Base URL 不能为空')
    const id = input.id || randomUUID()
    const existing = this.db.prepare('SELECT apiKey FROM providers WHERE id = ?').get(id) as
      { apiKey: Buffer | null } | undefined
    const key = input.apiKey?.trim() ? this.encrypt(input.apiKey.trim()) : existing?.apiKey || null
    this.db
      .prepare(
        `INSERT INTO providers (id,name,baseUrl,chatModels,imageModels,apiKey,unknownModels)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,baseUrl=excluded.baseUrl,chatModels=excluded.chatModels,
      imageModels=excluded.imageModels,apiKey=excluded.apiKey,unknownModels=excluded.unknownModels`,
      )
      .run(
        id,
        name,
        baseUrl,
        JSON.stringify(chatModels),
        JSON.stringify(imageModels),
        key,
        JSON.stringify(unknownModels),
      )
    return id
  }

  providerKey(id: string): string {
    const row = this.db.prepare('SELECT apiKey FROM providers WHERE id = ?').get(id) as
      { apiKey: Buffer | null } | undefined
    if (!row) throw new Error('Provider 不存在')
    return row.apiKey ? this.decrypt(row.apiKey) : ''
  }

  deleteProvider(id: string) {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }

  saveSession(input: Partial<StudioSession>): string {
    const id = input.id || randomUUID()
    const now = Date.now()
    const existing = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      StudioSession | undefined
    input = { ...existing, ...input }
    if (!input.chatModel?.trim() && !input.imageModel?.trim()) throw new Error('请先配置可用模型')
    if (!existing && !this.db.prepare('SELECT 1 FROM providers WHERE id = ?').get(input.providerId))
      throw new Error('Provider 不存在')
    const modelKind = input.modelKind ?? existing?.modelKind ?? 'chat'
    if (modelKind !== 'chat' && modelKind !== 'image') throw new Error('Invalid model kind')
    this.db
      .prepare(
        `INSERT INTO sessions (id,title,providerId,chatModel,imageModel,systemPrompt,createdAt,updatedAt,pinned,archived,modelKind)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,providerId=excluded.providerId,chatModel=excluded.chatModel,
      imageModel=excluded.imageModel,systemPrompt=excluded.systemPrompt,updatedAt=excluded.updatedAt,
      pinned=excluded.pinned,archived=excluded.archived,modelKind=excluded.modelKind`,
      )
      .run(
        id,
        input.title || '新对话',
        input.providerId,
        input.chatModel || '',
        input.imageModel || '',
        input.systemPrompt || '',
        existing?.createdAt || now,
        now,
        input.pinned ? 1 : 0,
        input.archived ? 1 : 0,
        modelKind,
      )
    return id
  }

  deleteSession(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  saveMessage(message: Message) {
    if (!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(message.sessionId)) return

    this.db
      .prepare(
        `INSERT INTO messages (id,sessionId,role,kind,content,imageFiles,providerName,model,createdAt,status,error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      content=excluded.content,imageFiles=excluded.imageFiles,status=excluded.status,error=excluded.error`,
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.kind,
        message.content,
        JSON.stringify(message.imageFiles),
        message.providerName,
        message.model,
        message.createdAt,
        message.status,
        message.error,
      )
    this.db
      .prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?')
      .run(Date.now(), message.sessionId)
  }

  session(id: string): StudioSession {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      StudioSession | undefined
    if (!row) throw new Error('会话不存在')
    return row
  }

  provider(id: string): Provider {
    const row = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
      ProviderRow | undefined
    if (!row) throw new Error('Provider 不存在')
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      chatModels: JSON.parse(row.chatModels),
      imageModels: JSON.parse(row.imageModels),
      hasKey: !!row.apiKey,
    }
  }

  history(sessionId: string): Message[] {
    return this.data().messages.filter(
      (message) =>
        message.sessionId === sessionId && message.kind === 'chat' && message.status === 'done',
    )
  }

  failStreaming(sessionId: string, error: string) {
    this.db
      .prepare(
        "UPDATE messages SET status = 'error', error = ? WHERE sessionId = ? AND status = 'streaming'",
      )
      .run(error, sessionId)
  }
}
