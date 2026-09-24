import bundled from '../../config/model-capabilities.json'

export type ModelKind = 'chat' | 'image'
export type ModelCapability = ModelKind | 'unknown'
export type ModelCatalog = {
  schemaVersion: 1
  version: number
  models: Record<string, ModelKind>
  prefixes: { prefix: string; kind: ModelKind }[]
}
const isKind = (value: unknown): value is ModelKind => value === 'chat' || value === 'image'

export function parseCatalog(value: unknown): ModelCatalog {
  if (!value || typeof value !== 'object') throw new Error('Invalid model catalog')
  const table = value as ModelCatalog
  if (
    table.schemaVersion !== 1 ||
    !Number.isSafeInteger(table.version) ||
    table.version < 1 ||
    !table.models ||
    typeof table.models !== 'object' ||
    Array.isArray(table.models) ||
    !Array.isArray(table.prefixes) ||
    Object.keys(table.models).length > 10000 ||
    table.prefixes.length > 1000 ||
    Object.entries(table.models).some(
      ([id, kind]) => !id.trim() || id.length > 200 || !isKind(kind),
    ) ||
    table.prefixes.some(
      (entry) =>
        !entry ||
        typeof entry.prefix !== 'string' ||
        !entry.prefix.trim() ||
        entry.prefix.length > 200 ||
        !isKind(entry.kind),
    )
  )
    throw new Error('Invalid model catalog')
  return table
}
export const bundledCatalog = parseCatalog(bundled)

export function modelKind(
  model: string,
  table = bundledCatalog,
  hint?: ModelKind,
): ModelCapability {
  const id = model.trim()
  if (Object.hasOwn(table.models, id)) return table.models[id]
  if (hint) return hint
  const rule = table.prefixes
    .filter((rule) => id.startsWith(rule.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return rule?.kind ?? 'unknown'
}

export function classifyModels(models: string[], table = bundledCatalog) {
  const chatModels: string[] = []
  const imageModels: string[] = []
  const unknownModels: string[] = []
  for (const model of new Set(models.map((item) => item.trim()).filter(Boolean))) {
    const kind = modelKind(model, table)
    ;(kind === 'image' ? imageModels : kind === 'chat' ? chatModels : unknownModels).push(model)
  }
  return { chatModels, imageModels, unknownModels }
}
