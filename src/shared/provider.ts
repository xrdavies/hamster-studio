import type { ProviderModels } from './types'
import { bundledCatalog, modelKind, type ModelCatalog } from './model-capabilities'

export function providerUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1') ? base + path : base + '/v1' + path
}

export function classifyProviderModels(
  payload: unknown,
  table: ModelCatalog = bundledCatalog,
): ProviderModels {
  const rows = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: unknown[] }).data
    : []
  const chatModels: string[] = []
  const imageModels: string[] = []
  const unknownModels: string[] = []
  for (const row of rows) {
    const item =
      typeof row === 'string'
        ? { id: row }
        : (row as { id?: unknown; type?: unknown; capabilities?: { image_generation?: unknown } })
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
    const hint =
      item.type === 'image' || item.capabilities?.image_generation === true
        ? 'image'
        : item.type === 'chat'
          ? 'chat'
          : undefined
    const kind = modelKind(item.id, table, hint)
    ;(kind === 'image' ? imageModels : kind === 'chat' ? chatModels : unknownModels).push(
      item.id.trim(),
    )
  }
  return {
    chatModels: [...new Set(chatModels)],
    imageModels: [...new Set(imageModels)],
    unknownModels: [...new Set(unknownModels)],
  }
}
