import type { ProviderModels } from '../shared/types'

export function providerUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base.endsWith('/v1') ? base + path : base + '/v1' + path
}

export function classifyProviderModels(payload: unknown): ProviderModels {
  const rows = Array.isArray((payload as { data?: unknown[] })?.data) ? (payload as { data: unknown[] }).data : []
  const chatModels: string[] = []
  const imageModels: string[] = []
  for (const row of rows) {
    const item = typeof row === 'string' ? { id: row } : row as { id?: unknown; type?: unknown; capabilities?: { image_generation?: unknown } }
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const image = item.type === 'image' || item.capabilities?.image_generation === true || /image|dall[-_ ]?e|imagen|flux|sdxl/i.test(item.id)
    ;(image ? imageModels : chatModels).push(item.id)
  }
  return { chatModels, imageModels }
}
